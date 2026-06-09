import type { SupabaseClient } from "@supabase/supabase-js";
import { readMatchScoreForAthlete } from "@/lib/crm/potential-athletes";
import { pickContactOutreachDraft } from "@/lib/crm/target-list-outreach";

export type TargetListContact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: "pending" | "revealed" | null;
  outreach_email_subject: string | null;
  outreach_email: string | null;
  /** Raw drafts for client-side upsert on edit; not shown in table. */
  email_drafts: unknown;
};

export type TargetListRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  match_score: number | null;
  website: string | null;
  hq_phone: string | null;
  company_description: string | null;
  past_partnerships: string | null;
  personal_notes: string | null;
  outreach_email_subject: string | null;
  outreach_email: string | null;
  contacts: TargetListContact[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
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

const UNCATEGORIZED_SORT = "\uFFFFUncategorized";

export function sortTargetListRows(rows: TargetListRow[]): TargetListRow[] {
  return [...rows].sort((a, b) => {
    const ca = (a.category ?? UNCATEGORIZED_SORT).toLowerCase();
    const cb = (b.category ?? UNCATEGORIZED_SORT).toLowerCase();
    const catCmp = ca.localeCompare(cb);
    if (catCmp !== 0) return catCmp;
    const scoreA = a.match_score ?? Number.NEGATIVE_INFINITY;
    const scoreB = b.match_score ?? Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" });
  });
}

/**
 * Pipeline cards for this user where `potential_athletes` includes `athleteId`,
 * merged with visible CRM contacts (same logic as GET /api/athletes/:id/target-list).
 */
export async function fetchAthleteTargetListRows(
  supabase: SupabaseClient,
  createdByUserId: string,
  athleteId: string
): Promise<TargetListRow[]> {
  const { data: pipelineRows, error: pipelineErr } = await supabase
    .from("crm_companies_pipeline")
    .select(
      `
        id,
        company_id,
        potential_athletes,
        company_description,
        past_partnerships,
        personal_notes,
        outreach_email_subject,
        outreach_email,
        archived,
        companies(name, website, hq_phone, product_category, notes)
      `
    )
    .eq("created_by_user_id", createdByUserId)
    .eq("archived", false);
  if (pipelineErr) {
    throw new Error(pipelineErr.message);
  }

  const assigned = (pipelineRows ?? []).filter((r: any) => {
    const arr = Array.isArray(r.potential_athletes) ? r.potential_athletes : [];
    return arr.some((p: any) => p && typeof p === "object" && String(p.athlete_id ?? "") === athleteId);
  });

  if (assigned.length === 0) {
    return [];
  }

  const companyIds = [...new Set(assigned.map((r: any) => r.company_id).filter(Boolean))];

  const { data: contactRows, error: contactErr } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, company_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, email_drafts, archived"
    )
    .in("company_id", companyIds)
    .eq("created_by_user_id", createdByUserId)
    .eq("archived", false);
  if (contactErr) {
    throw new Error(contactErr.message);
  }

  const contactsByCompany = new Map<string, TargetListContact[]>();
  for (const c of contactRows ?? []) {
    const outreach = pickContactOutreachDraft(c.email_drafts, athleteId);
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
      outreach_email_subject: outreach?.subject ?? null,
      outreach_email: outreach?.body ?? null,
      email_drafts: c.email_drafts ?? [],
    });
    contactsByCompany.set(c.company_id, list);
  }

  const rows: TargetListRow[] = assigned.map((r: any) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const category = company?.product_category ? String(company.product_category) : null;
    const contacts = dedupeContactsForCompany(contactsByCompany.get(r.company_id) ?? []);
    return {
      pipeline_id: r.id,
      company_id: r.company_id,
      company_name: String(company?.name ?? ""),
      category,
      match_score: readMatchScoreForAthlete(r.potential_athletes, athleteId),
      website: company?.website ?? null,
      hq_phone: company?.hq_phone ?? null,
      company_description: r.company_description ?? null,
      past_partnerships: r.past_partnerships ?? null,
      personal_notes: r.personal_notes ?? null,
      outreach_email_subject: r.outreach_email_subject ?? null,
      outreach_email: r.outreach_email ?? null,
      contacts,
    };
  });

  return sortTargetListRows(rows);
}
