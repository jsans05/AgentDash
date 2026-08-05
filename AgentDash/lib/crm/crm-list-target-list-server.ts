import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sortTargetListRows,
  type TargetListContact,
  type TargetListRow,
} from "@/lib/crm/athlete-target-list";
import { canonicalizeCompanyCategory } from "@/lib/crm/company-category";
import {
  COMPANY_FIRMOGRAPHICS_DB_COLUMNS,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";
import { assertCrmListOwner } from "@/lib/crm/crm-lists-server";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function dedupeContactsForCompany(contacts: TargetListContact[]): TargetListContact[] {
  const byKey = new Map<string, TargetListContact>();
  for (const contact of contacts) {
    const emailKey = normalizeText(contact.email);
    const nameKey = `${normalizeText(contact.first_name)}||${normalizeText(contact.last_name)}`;
    const dedupeKey = emailKey ? `email:${emailKey}` : `name:${nameKey}`;
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, contact);
      continue;
    }
    byKey.set(dedupeKey, {
      ...existing,
      first_name: existing.first_name || contact.first_name,
      last_name: existing.last_name || contact.last_name,
      role: existing.role ?? contact.role ?? null,
      email: existing.email ?? contact.email ?? null,
      phone: existing.phone ?? contact.phone ?? null,
      notes: existing.notes ?? contact.notes ?? null,
      linkedin_url: existing.linkedin_url ?? contact.linkedin_url ?? null,
      apollo_person_id: existing.apollo_person_id ?? contact.apollo_person_id ?? null,
      apollo_reveal_status: existing.apollo_reveal_status ?? contact.apollo_reveal_status ?? null,
      apollo_phone_reveal_status:
        existing.apollo_phone_reveal_status ?? contact.apollo_phone_reveal_status ?? null,
      outreach_email_subject: existing.outreach_email_subject ?? contact.outreach_email_subject ?? null,
      outreach_email: existing.outreach_email ?? contact.outreach_email ?? null,
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const aName = `${a.last_name} ${a.first_name}`.trim().toLowerCase();
    const bName = `${b.last_name} ${b.first_name}`.trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

/**
 * Load spreadsheet rows for a personal CRM list: list membership intersected
 * with the viewer's own pipeline cards and contacts.
 */
export async function fetchCrmListTargetListRows(
  supabase: SupabaseClient,
  listId: string,
  viewerUserId: string
): Promise<TargetListRow[]> {
  await assertCrmListOwner(supabase, listId, viewerUserId);

  const { data: members, error: memErr } = await supabase
    .from("crm_list_members")
    .select("company_id")
    .eq("list_id", listId);
  if (memErr) throw new Error(memErr.message);
  if (!members?.length) return [];

  const companyIds = [...new Set(members.map((m) => m.company_id).filter(Boolean))];

  const { data: pipelineRows, error: pipelineErr } = await supabase
    .from("crm_companies_pipeline")
    .select(
      `
        id,
        company_id,
        created_by_user_id,
        company_description,
        past_partnerships,
        personal_notes,
        outreach_email_subject,
        outreach_email,
        archived,
        companies(name, website, hq_phone, product_category, notes, ${COMPANY_FIRMOGRAPHICS_DB_COLUMNS})
      `
    )
    .eq("created_by_user_id", viewerUserId)
    .eq("archived", false)
    .in("company_id", companyIds);
  if (pipelineErr) throw new Error(pipelineErr.message);

  const pipelineByCompany = new Map<string, Record<string, unknown>>();
  for (const row of pipelineRows ?? []) {
    pipelineByCompany.set(String(row.company_id), row as Record<string, unknown>);
  }

  const { data: orphanCompanies, error: coErr } = await supabase
    .from("companies")
    .select(`company_id, name, website, hq_phone, product_category, notes, ${COMPANY_FIRMOGRAPHICS_DB_COLUMNS}`)
    .in(
      "company_id",
      companyIds.filter((id) => !pipelineByCompany.has(id))
    );
  if (coErr) throw new Error(coErr.message);

  const { data: contactRows, error: contactErr } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, company_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status, email_drafts, archived"
    )
    .eq("created_by_user_id", viewerUserId)
    .in("company_id", companyIds)
    .eq("archived", false);
  if (contactErr) throw new Error(contactErr.message);

  const contactsByCompany = new Map<string, TargetListContact[]>();
  for (const c of contactRows ?? []) {
    const list = contactsByCompany.get(c.company_id) ?? [];
    list.push({
      contact_id: c.contact_id,
      first_name: c.first_name ?? "",
      last_name: c.last_name ?? "",
      role: c.role ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      notes: c.notes ?? null,
      linkedin_url: c.linkedin_url ?? null,
      apollo_person_id: c.apollo_person_id ?? null,
      apollo_reveal_status:
        c.apollo_reveal_status === "pending" || c.apollo_reveal_status === "revealed"
          ? c.apollo_reveal_status
          : null,
      apollo_phone_reveal_status:
        c.apollo_phone_reveal_status === "pending" || c.apollo_phone_reveal_status === "revealed"
          ? c.apollo_phone_reveal_status
          : null,
      outreach_email_subject: null,
      outreach_email: null,
      email_drafts: c.email_drafts ?? [],
    });
    contactsByCompany.set(c.company_id, list);
  }

  const rows: TargetListRow[] = [];

  for (const companyId of companyIds) {
    const pipeline = pipelineByCompany.get(companyId);
    if (pipeline) {
      const company = Array.isArray(pipeline.companies)
        ? pipeline.companies[0]
        : pipeline.companies;
      const companyRec = company as Record<string, unknown> | null | undefined;
      rows.push({
        pipeline_id: String(pipeline.id),
        company_id: companyId,
        company_name: String(companyRec?.name ?? ""),
        category: canonicalizeCompanyCategory(companyRec?.product_category),
        match_score: null,
        website: (companyRec?.website as string | null | undefined) ?? null,
        hq_phone: (companyRec?.hq_phone as string | null | undefined) ?? null,
        company_description: (pipeline.company_description as string | null | undefined) ?? null,
        past_partnerships: (pipeline.past_partnerships as string | null | undefined) ?? null,
        personal_notes: (pipeline.personal_notes as string | null | undefined) ?? null,
        outreach_email_subject: (pipeline.outreach_email_subject as string | null | undefined) ?? null,
        outreach_email: (pipeline.outreach_email as string | null | undefined) ?? null,
        contacts: dedupeContactsForCompany(contactsByCompany.get(companyId) ?? []),
        owner_user_id: viewerUserId,
        owner_name: "Mine",
        is_own: true,
        ...mapCompanyFirmographics(companyRec),
      });
      continue;
    }

    const orphan = (orphanCompanies ?? []).find((c) => c.company_id === companyId);
    if (orphan) {
      rows.push({
        pipeline_id: `list-member:${companyId}`,
        company_id: companyId,
        company_name: String(orphan.name ?? ""),
        category: canonicalizeCompanyCategory(orphan.product_category),
        match_score: null,
        website: orphan.website ?? null,
        hq_phone: orphan.hq_phone ?? null,
        company_description: null,
        past_partnerships: null,
        personal_notes: null,
        outreach_email_subject: null,
        outreach_email: null,
        contacts: dedupeContactsForCompany(contactsByCompany.get(companyId) ?? []),
        owner_user_id: viewerUserId,
        owner_name: "Mine",
        is_own: true,
        ...mapCompanyFirmographics(orphan as Record<string, unknown>),
      });
    }
  }

  return sortTargetListRows(rows);
}

export async function fetchCrmListCompanyIds(
  supabase: SupabaseClient,
  listId: string,
  userId: string
): Promise<string[]> {
  await assertCrmListOwner(supabase, listId, userId);
  const { data, error } = await supabase
    .from("crm_list_members")
    .select("company_id")
    .eq("list_id", listId);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.company_id).filter(Boolean))];
}
