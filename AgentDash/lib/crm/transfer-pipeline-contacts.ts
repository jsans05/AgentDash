import type { SupabaseClient } from "@supabase/supabase-js";
import { contactsLikelySamePerson } from "@/lib/crm/target-list-duplicate-contacts";

type ContactRow = {
  contact_id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: string | null;
  apollo_phone_reveal_status: string | null;
};

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function findDestMatch(source: ContactRow, dest: ContactRow[]): ContactRow | undefined {
  if (source.apollo_person_id) {
    const byApollo = dest.find((row) => row.apollo_person_id === source.apollo_person_id);
    if (byApollo) return byApollo;
  }
  const email = normalizeEmail(source.email);
  if (email) {
    const byEmail = dest.find((row) => normalizeEmail(row.email) === email);
    if (byEmail) return byEmail;
  }
  return dest.find((row) =>
    contactsLikelySamePerson(
      { first_name: source.first_name ?? "", last_name: source.last_name ?? "" },
      { first_name: row.first_name ?? "", last_name: row.last_name ?? "" }
    )
  );
}

function preferStatus(
  dest: string | null,
  source: string | null
): "pending" | "revealed" | null | undefined {
  if (dest === "revealed" || source === "revealed") return "revealed";
  if (dest === "pending" || source === "pending") return "pending";
  return undefined;
}

function mergeMissingFields(dest: ContactRow, source: ContactRow): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (!dest.role && source.role) patch.role = source.role;
  if (!dest.email && source.email) patch.email = source.email;
  if (!dest.phone && source.phone) patch.phone = source.phone;
  if (!dest.linkedin_url && source.linkedin_url) patch.linkedin_url = source.linkedin_url;
  if (!dest.apollo_person_id && source.apollo_person_id) {
    patch.apollo_person_id = source.apollo_person_id;
  }
  const emailStatus = preferStatus(dest.apollo_reveal_status, source.apollo_reveal_status);
  if (emailStatus && emailStatus !== dest.apollo_reveal_status) {
    patch.apollo_reveal_status = emailStatus;
  }
  const phoneStatus = preferStatus(
    dest.apollo_phone_reveal_status,
    source.apollo_phone_reveal_status
  );
  if (phoneStatus && phoneStatus !== dest.apollo_phone_reveal_status) {
    patch.apollo_phone_reveal_status = phoneStatus;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Move the assigner's company contacts onto the assignee so role/email/LinkedIn
 * /phone follow the pipeline card. Duplicates merge into the assignee's row.
 */
export async function transferPipelineContacts(
  supabaseAdmin: SupabaseClient,
  params: { fromUserId: string; toUserId: string; companyIds: string[] }
): Promise<{ transferred: number; merged: number }> {
  const companyIds = [...new Set(params.companyIds.filter(Boolean))];
  if (companyIds.length === 0 || params.fromUserId === params.toUserId) {
    return { transferred: 0, merged: 0 };
  }

  const { data: sourceRows, error: sourceErr } = await supabaseAdmin
    .from("crm_contacts")
    .select(
      "contact_id, company_id, first_name, last_name, role, email, phone, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status"
    )
    .eq("created_by_user_id", params.fromUserId)
    .in("company_id", companyIds)
    .eq("archived", false);
  if (sourceErr) throw new Error(sourceErr.message);
  const sources = (sourceRows ?? []) as ContactRow[];
  if (sources.length === 0) return { transferred: 0, merged: 0 };

  const { data: destRows, error: destErr } = await supabaseAdmin
    .from("crm_contacts")
    .select(
      "contact_id, company_id, first_name, last_name, role, email, phone, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status"
    )
    .eq("created_by_user_id", params.toUserId)
    .in("company_id", companyIds)
    .eq("archived", false);
  if (destErr) throw new Error(destErr.message);

  const destByCompany = new Map<string, ContactRow[]>();
  for (const row of (destRows ?? []) as ContactRow[]) {
    const list = destByCompany.get(row.company_id) ?? [];
    list.push(row);
    destByCompany.set(row.company_id, list);
  }

  const toTransfer: string[] = [];
  let merged = 0;

  for (const source of sources) {
    const destList = destByCompany.get(source.company_id) ?? [];
    const match = findDestMatch(source, destList);
    if (!match) {
      toTransfer.push(source.contact_id);
      destList.push({ ...source, contact_id: source.contact_id });
      destByCompany.set(source.company_id, destList);
      continue;
    }
    const patch = mergeMissingFields(match, source);
    if (patch) {
      const { error: mergeErr } = await supabaseAdmin
        .from("crm_contacts")
        .update(patch)
        .eq("contact_id", match.contact_id);
      if (mergeErr) throw new Error(mergeErr.message);
    }
    const { error: archiveErr } = await supabaseAdmin
      .from("crm_contacts")
      .update({ archived: true })
      .eq("contact_id", source.contact_id);
    if (archiveErr) throw new Error(archiveErr.message);
    merged += 1;
  }

  if (toTransfer.length > 0) {
    const { error: transferErr } = await supabaseAdmin
      .from("crm_contacts")
      .update({ created_by_user_id: params.toUserId })
      .in("contact_id", toTransfer)
      .eq("created_by_user_id", params.fromUserId);
    if (transferErr) throw new Error(transferErr.message);
  }

  return { transferred: toTransfer.length, merged };
}
