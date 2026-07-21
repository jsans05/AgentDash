import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readMatchScoreForAthlete } from "@/lib/crm/potential-athletes";
import { pickContactOutreachDraft } from "@/lib/crm/target-list-outreach";
import {
  COMPANY_FIRMOGRAPHICS_DB_COLUMNS,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";
import {
  sortTargetListRows,
  type TargetListContact,
  type TargetListRow,
} from "@/lib/crm/athlete-target-list";
import { canonicalizeCompanyCategory } from "@/lib/crm/company-category";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatOwnerName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!profile) return "Unknown";
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name || String(profile.email ?? "").trim() || "Unknown";
}

function mergeContact(base: TargetListContact, next: TargetListContact): TargetListContact {
  return {
    contact_id: base.contact_id,
    first_name: base.first_name || next.first_name,
    last_name: base.last_name || next.last_name,
    role: base.role ?? next.role ?? null,
    email: base.email ?? next.email ?? null,
    phone: base.phone ?? next.phone ?? null,
    notes: base.notes ?? next.notes ?? null,
    linkedin_url: base.linkedin_url ?? next.linkedin_url ?? null,
    apollo_person_id: base.apollo_person_id ?? next.apollo_person_id ?? null,
    apollo_reveal_status: base.apollo_reveal_status ?? next.apollo_reveal_status ?? null,
    apollo_phone_reveal_status: base.apollo_phone_reveal_status ?? next.apollo_phone_reveal_status ?? null,
    outreach_email_subject: base.outreach_email_subject ?? next.outreach_email_subject ?? null,
    outreach_email: base.outreach_email ?? next.outreach_email ?? null,
    email_drafts: base.email_drafts ?? next.email_drafts ?? [],
  };
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
    byKey.set(dedupeKey, mergeContact(existing, contact));
  }

  return [...byKey.values()].sort((a, b) => {
    const aName = `${a.last_name} ${a.first_name}`.trim().toLowerCase();
    const bName = `${b.last_name} ${b.first_name}`.trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

/**
 * Shared athlete target list: every non-archived pipeline card (any teammate)
 * where `potential_athletes` includes `athleteId`. Contacts are scoped per
 * card owner so outreach drafts do not cross-pollinate.
 *
 * Server-only — do not import from client components.
 */
export async function fetchAthleteTargetListRows(
  _supabase: SupabaseClient,
  viewerUserId: string,
  athleteId: string
): Promise<TargetListRow[]> {
  const supabaseAdmin = await createServiceRoleClient();

  // Filter in Postgres — loading every active pipeline card and filtering in JS
  // hits PostgREST's default 1000-row cap and silently drops brands from the list.
  const PAGE = 1000;
  const pipelineRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: pipelineErr } = await supabaseAdmin
      .from("crm_companies_pipeline")
      .select(
        `
        id,
        company_id,
        created_by_user_id,
        potential_athletes,
        company_description,
        past_partnerships,
        personal_notes,
        outreach_email_subject,
        outreach_email,
        archived,
        companies(name, website, hq_phone, product_category, notes, ${COMPANY_FIRMOGRAPHICS_DB_COLUMNS}),
        profiles:created_by_user_id(first_name, last_name, email)
      `
      )
      .eq("archived", false)
      .contains("potential_athletes", JSON.stringify([{ athlete_id: athleteId }]))
      .range(from, from + PAGE - 1);
    if (pipelineErr) {
      throw new Error(pipelineErr.message);
    }
    const page = (data ?? []) as Record<string, unknown>[];
    pipelineRows.push(...page);
    if (page.length < PAGE) break;
  }

  const assigned = pipelineRows;

  if (assigned.length === 0) {
    return [];
  }

  const ownerCompanyPairs = assigned.map((r: Record<string, unknown>) => ({
    owner_id: String(r.created_by_user_id ?? ""),
    company_id: String(r.company_id ?? ""),
  }));
  const companyIds = [...new Set(ownerCompanyPairs.map((p) => p.company_id).filter(Boolean))];
  const ownerIds = [...new Set(ownerCompanyPairs.map((p) => p.owner_id).filter(Boolean))];

  const { data: contactRows, error: contactErr } = await supabaseAdmin
    .from("crm_contacts")
    .select(
      "contact_id, company_id, created_by_user_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status, email_drafts, archived"
    )
    .in("company_id", companyIds)
    .in("created_by_user_id", ownerIds)
    .eq("archived", false);
  if (contactErr) {
    throw new Error(contactErr.message);
  }

  const contactsByOwnerCompany = new Map<string, TargetListContact[]>();
  for (const c of contactRows ?? []) {
    const key = `${c.created_by_user_id}::${c.company_id}`;
    const outreach = pickContactOutreachDraft(c.email_drafts, athleteId);
    const list = contactsByOwnerCompany.get(key) ?? [];
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
      outreach_email_subject: outreach?.subject ?? null,
      outreach_email: outreach?.body ?? null,
      email_drafts: c.email_drafts ?? [],
    });
    contactsByOwnerCompany.set(key, list);
  }

  const rows: TargetListRow[] = assigned.map((r: Record<string, unknown>) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const companyRec = company as Record<string, unknown> | null | undefined;
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    const ownerUserId = String(r.created_by_user_id ?? "");
    const category = canonicalizeCompanyCategory(companyRec?.product_category);
    const contactKey = `${ownerUserId}::${r.company_id}`;
    const contacts = dedupeContactsForCompany(contactsByOwnerCompany.get(contactKey) ?? []);
    return {
      pipeline_id: String(r.id),
      company_id: String(r.company_id),
      company_name: String(companyRec?.name ?? ""),
      category,
      match_score: readMatchScoreForAthlete(r.potential_athletes, athleteId),
      website: (companyRec?.website as string | null | undefined) ?? null,
      hq_phone: (companyRec?.hq_phone as string | null | undefined) ?? null,
      company_description: (r.company_description as string | null | undefined) ?? null,
      past_partnerships: (r.past_partnerships as string | null | undefined) ?? null,
      personal_notes: (r.personal_notes as string | null | undefined) ?? null,
      outreach_email_subject: (r.outreach_email_subject as string | null | undefined) ?? null,
      outreach_email: (r.outreach_email as string | null | undefined) ?? null,
      contacts,
      owner_user_id: ownerUserId,
      owner_name: formatOwnerName(
        profile as {
          first_name?: string | null;
          last_name?: string | null;
          email?: string | null;
        } | null
      ),
      is_own: ownerUserId === viewerUserId,
      ...mapCompanyFirmographics(companyRec),
    };
  });

  return sortTargetListRows(rows);
}
