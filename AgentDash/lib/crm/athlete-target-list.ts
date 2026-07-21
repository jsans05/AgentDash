import type { CompanyAgencyActivity } from "@/lib/crm/company-agency-activity";
import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";

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
  apollo_phone_reveal_status: "pending" | "revealed" | null;
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
  /** Owner of this pipeline card (teammate assignment). */
  owner_user_id: string;
  owner_name: string;
  /** True when the viewing user owns this row. */
  is_own: boolean;
  agency_activity?: CompanyAgencyActivity | null;
} & CompanyFirmographics;

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
