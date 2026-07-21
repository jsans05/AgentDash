import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyAgencyActivity } from "@/lib/crm/company-agency-activity";
import {
  sortTargetListRows,
  type TargetListContact,
  type TargetListRow,
} from "@/lib/crm/athlete-target-list";
import {
  COMPANY_FIRMOGRAPHICS_DB_COLUMNS,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";
import {
  parseOptionalMatchScore,
  type PotentialAthleteEntry,
} from "@/lib/crm/potential-athletes";
import { pickContactOutreachDraft } from "@/lib/crm/target-list-outreach";
import { canonicalizeCompanyCategory } from "@/lib/crm/company-category";

export type MasterTargetListAthlete = {
  athlete_id: string;
  name: string;
  sport?: string | null;
  match_score?: number | null;
};

export type MasterTargetListRow = TargetListRow & {
  assigned_athletes: MasterTargetListAthlete[];
  agency_activity: CompanyAgencyActivity | null;
};

// Keep well under Node/undici's ~16KB header limit: a chunk of UUIDs in an
// `.in(...)` filter must not grow the request URL large enough to trigger
// `TypeError: fetch failed` (UND_ERR_HEADERS_OVERFLOW).
const IN_FILTER_CHUNK_SIZE = 200;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
      email_drafts: existing.email_drafts ?? contact.email_drafts ?? [],
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const aName = `${a.last_name} ${a.first_name}`.trim().toLowerCase();
    const bName = `${b.last_name} ${b.first_name}`.trim().toLowerCase();
    return aName.localeCompare(bName);
  });
}

function cardMatchesRoster(potentialAthletes: unknown, rosterSet: Set<string>): boolean {
  const arr = Array.isArray(potentialAthletes) ? potentialAthletes : [];
  return arr.some(
    (p) =>
      p &&
      typeof p === "object" &&
      rosterSet.has(String((p as PotentialAthleteEntry).athlete_id ?? ""))
  );
}

export function buildAssignedAthletes(
  potentialAthletes: unknown,
  rosterSet: Set<string>
): MasterTargetListAthlete[] {
  const arr = Array.isArray(potentialAthletes) ? potentialAthletes : [];
  return arr
    .filter(
      (p) =>
        p &&
        typeof p === "object" &&
        rosterSet.has(String((p as PotentialAthleteEntry).athlete_id ?? ""))
    )
    .map((p) => {
      const entry = p as PotentialAthleteEntry;
      return {
        athlete_id: String(entry.athlete_id ?? ""),
        name: String(entry.name ?? ""),
        sport: entry.sport ?? null,
        match_score: parseOptionalMatchScore(entry.match_score),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function maxMatchScoreFromAthletes(athletes: MasterTargetListAthlete[]): number | null {
  let max: number | null = null;
  for (const athlete of athletes) {
    if (athlete.match_score == null) continue;
    if (max == null || athlete.match_score > max) max = athlete.match_score;
  }
  return max;
}

export async function fetchMasterTargetListRows(
  supabase: SupabaseClient,
  createdByUserId: string,
  rosterAthleteIds: string[]
): Promise<Omit<MasterTargetListRow, "agency_activity">[]> {
  const rosterSet = new Set(rosterAthleteIds.map(String).filter(Boolean));
  if (rosterSet.size === 0) return [];

  const PAGE = 1000;
  const pipelineRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: pipelineErr } = await supabase
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
        companies(name, website, hq_phone, product_category, notes, ${COMPANY_FIRMOGRAPHICS_DB_COLUMNS})
      `
      )
      .eq("created_by_user_id", createdByUserId)
      .eq("archived", false)
      .range(from, from + PAGE - 1);
    if (pipelineErr) throw new Error(pipelineErr.message);
    const page = (data ?? []) as Record<string, unknown>[];
    pipelineRows.push(...page);
    if (page.length < PAGE) break;
  }

  const assigned = pipelineRows.filter((r: { potential_athletes?: unknown }) =>
    cardMatchesRoster(r.potential_athletes, rosterSet)
  );
  if (assigned.length === 0) return [];

  const companyIds = [
    ...new Set(assigned.map((r) => String(r.company_id ?? "")).filter(Boolean)),
  ];

  type ContactRow = {
    contact_id: string;
    company_id: string;
    first_name: string | null;
    last_name: string | null;
    role: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    linkedin_url: string | null;
    apollo_person_id: string | null;
    apollo_reveal_status: string | null;
    apollo_phone_reveal_status: string | null;
    email_drafts: unknown;
    archived: boolean | null;
  };

  const contactRows: ContactRow[] = [];
  for (const companyIdChunk of chunkArray(companyIds, IN_FILTER_CHUNK_SIZE)) {
    const { data: chunkRows, error: contactErr } = await supabase
      .from("crm_contacts")
      .select(
        "contact_id, company_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status, email_drafts, archived"
      )
      .in("company_id", companyIdChunk)
      .eq("created_by_user_id", createdByUserId)
      .eq("archived", false);
    if (contactErr) throw new Error(contactErr.message);
    for (const row of chunkRows ?? []) contactRows.push(row as ContactRow);
  }

  const contactsByCompany = new Map<string, TargetListContact[]>();
  const outreachAthleteByCompany = new Map<string, string | null>();
  for (const card of assigned) {
    const companyId = String((card as { company_id: string }).company_id);
    const assignedAthletes = buildAssignedAthletes(
      (card as { potential_athletes?: unknown }).potential_athletes,
      rosterSet
    );
    outreachAthleteByCompany.set(
      companyId,
      assignedAthletes.length === 1 ? assignedAthletes[0]!.athlete_id : null
    );
  }

  for (const c of contactRows ?? []) {
    const outreachAthleteId = outreachAthleteByCompany.get(c.company_id) ?? null;
    const outreach = outreachAthleteId
      ? pickContactOutreachDraft(c.email_drafts, outreachAthleteId)
      : null;
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
      outreach_email_subject: outreach?.subject ?? null,
      outreach_email: outreach?.body ?? null,
      email_drafts: c.email_drafts ?? [],
    });
    contactsByCompany.set(c.company_id, list);
  }

  const rows: Omit<MasterTargetListRow, "agency_activity">[] = assigned.map((r: Record<string, unknown>) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const companyRecord = company as Record<string, unknown> | null | undefined;
    const assignedAthletes = buildAssignedAthletes(r.potential_athletes, rosterSet);
    const contacts = dedupeContactsForCompany(
      contactsByCompany.get(String(r.company_id)) ?? []
    );
    return {
      pipeline_id: String(r.id),
      company_id: String(r.company_id),
      company_name: String((companyRecord?.name as string | undefined) ?? ""),
      category: canonicalizeCompanyCategory(companyRecord?.product_category),
      match_score: maxMatchScoreFromAthletes(assignedAthletes),
      website: (companyRecord?.website as string | null | undefined) ?? null,
      hq_phone: (companyRecord?.hq_phone as string | null | undefined) ?? null,
      company_description: (r.company_description as string | null | undefined) ?? null,
      past_partnerships: (r.past_partnerships as string | null | undefined) ?? null,
      personal_notes: (r.personal_notes as string | null | undefined) ?? null,
      outreach_email_subject: (r.outreach_email_subject as string | null | undefined) ?? null,
      outreach_email: (r.outreach_email as string | null | undefined) ?? null,
      contacts,
      assigned_athletes: assignedAthletes,
      owner_user_id: createdByUserId,
      owner_name: "You",
      is_own: true,
      ...mapCompanyFirmographics(companyRecord),
    };
  });

  return sortTargetListRows(rows) as Omit<MasterTargetListRow, "agency_activity">[];
}
