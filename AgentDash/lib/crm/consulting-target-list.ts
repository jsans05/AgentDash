import type { SupabaseClient } from "@supabase/supabase-js";
import type { TargetListContact, TargetListRow } from "@/lib/crm/athlete-target-list";
import { sortTargetListRows } from "@/lib/crm/athlete-target-list";
import {
  COMPANY_FIRMOGRAPHICS_DB_COLUMNS,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";

export type { TargetListContact, TargetListRow };

export type ConsultingProfileSeed = {
  id: string;
  company_id: string;
  company_name: string;
  website: string | null;
  label: string | null;
};

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
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const aName = `${a.last_name} ${a.first_name}`.trim().toLowerCase();
    const bName = `${b.last_name} ${b.first_name}`.trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

export async function fetchConsultingTargetListRows(
  supabase: SupabaseClient,
  consultingProfileId: string
): Promise<TargetListRow[]> {
  const { data: entries, error: entriesErr } = await supabase
    .from("consulting_target_list")
    .select(
      `
        id,
        company_id,
        industry_category,
        match_score,
        company_description,
        personal_notes,
        companies(name, website, hq_phone, product_category, ${COMPANY_FIRMOGRAPHICS_DB_COLUMNS})
      `
    )
    .eq("consulting_profile_id", consultingProfileId);
  if (entriesErr) throw new Error(entriesErr.message);

  if (!entries?.length) return [];

  const companyIds = [...new Set(entries.map((e) => e.company_id).filter(Boolean))];

  const { data: contactRows, error: contactErr } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, company_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status, consulting_profile_id, archived"
    )
    .in("company_id", companyIds)
    .eq("consulting_profile_id", consultingProfileId)
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
      email_drafts: [],
    });
    contactsByCompany.set(c.company_id, list);
  }

  const rows: TargetListRow[] = entries.map((e) => {
    const company = Array.isArray(e.companies) ? e.companies[0] : e.companies;
    const category =
      e.industry_category?.trim() ||
      (company?.product_category ? String(company.product_category) : null);
    return {
      pipeline_id: e.id,
      company_id: e.company_id,
      company_name: String(company?.name ?? ""),
      category,
      match_score: e.match_score != null ? Number(e.match_score) : null,
      website: company?.website ?? null,
      hq_phone: company?.hq_phone ?? null,
      company_description: e.company_description ?? null,
      past_partnerships: null,
      personal_notes: e.personal_notes ?? null,
      outreach_email_subject: null,
      outreach_email: null,
      contacts: dedupeContactsForCompany(contactsByCompany.get(e.company_id) ?? []),
      ...mapCompanyFirmographics(company as Record<string, unknown> | undefined),
    };
  });

  return sortTargetListRows(rows);
}

export async function fetchConsultingProfileSeeds(
  supabase: SupabaseClient,
  profileId: string
): Promise<ConsultingProfileSeed[]> {
  const { data, error } = await supabase
    .from("consulting_profile_seeds")
    .select("id, company_id, label, companies(name, website)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return {
      id: row.id,
      company_id: row.company_id,
      company_name: String(company?.name ?? ""),
      website: company?.website ?? null,
      label: row.label ?? null,
    };
  });
}

export async function getConsultingTargetListDomains(
  supabase: SupabaseClient,
  consultingProfileId: string
): Promise<string[]> {
  const rows = await fetchConsultingTargetListRows(supabase, consultingProfileId);
  const { domainFromWebsite, normalizeDomainForCompare } = await import(
    "@/lib/apollo/org-search-utils"
  );
  const domains: string[] = [];
  for (const row of rows) {
    const d = domainFromWebsite(row.website);
    if (d) domains.push(normalizeDomainForCompare(d));
  }
  return [...new Set(domains.filter(Boolean))];
}
