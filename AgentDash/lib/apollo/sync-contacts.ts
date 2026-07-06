import type { SupabaseClient } from "@supabase/supabase-js";
import { apolloLastNameForStorage, isPlaceholderLastName } from "@/lib/crm/contact-display-name";
import { contactsLikelySamePerson } from "@/lib/crm/target-list-duplicate-contacts";
import type { ApolloSearchPerson } from "@/lib/apollo/types";

export type SyncedApolloContact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: "pending" | "revealed" | null;
};

export async function upsertApolloPendingContacts(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    people: ApolloSearchPerson[];
    consultingProfileId?: string | null;
  }
): Promise<{ created: number; updated: number; contacts: SyncedApolloContact[] }> {
  const { userId, companyId, people, consultingProfileId } = params;
  let created = 0;
  let updated = 0;
  const contacts: SyncedApolloContact[] = [];

  type ExistingRow = {
    contact_id: string;
    first_name: string;
    last_name: string;
    role: string | null;
    email: string | null;
    linkedin_url: string | null;
    apollo_person_id: string | null;
    apollo_reveal_status: string | null;
  };

  let existingQuery = supabaseAdmin
    .from("crm_contacts")
    .select(
      "contact_id, first_name, last_name, role, email, linkedin_url, apollo_person_id, apollo_reveal_status"
    )
    .eq("company_id", companyId);

  if (consultingProfileId) {
    existingQuery = existingQuery.eq("consulting_profile_id", consultingProfileId);
  } else {
    existingQuery = existingQuery.eq("created_by_user_id", userId);
  }

  const { data: existingRows } = await existingQuery;

  const byApolloId = new Map<string, ExistingRow>();
  const byName = new Map<string, ExistingRow>();
  for (const row of existingRows ?? []) {
    if (row.apollo_person_id) byApolloId.set(String(row.apollo_person_id), row);
    const nameKey = `${String(row.first_name).toLowerCase()}||${String(row.last_name).toLowerCase()}`;
    byName.set(nameKey, row);
  }

  for (const person of people) {
    const last_name = apolloLastNameForStorage(person.last_name);
    const nameKey = `${person.first_name.toLowerCase()}||${last_name.toLowerCase()}`;
    let existing =
      byApolloId.get(person.apollo_person_id) ??
      (!isPlaceholderLastName(last_name) ? byName.get(nameKey) : undefined);

    if (!existing) {
      existing = (existingRows ?? []).find(
        (row) =>
          !row.apollo_person_id &&
          contactsLikelySamePerson(
            { first_name: person.first_name, last_name },
            { first_name: row.first_name, last_name: row.last_name }
          )
      );
    }

    const payload = {
      company_id: companyId,
      created_by_user_id: userId,
      consulting_profile_id: consultingProfileId ?? null,
      first_name: person.first_name,
      last_name,
      role: person.title || null,
      email: existing?.email ?? null,
      linkedin_url: existing?.linkedin_url ?? person.linkedin_url ?? null,
      apollo_person_id: person.apollo_person_id,
      apollo_reveal_status: existing?.apollo_reveal_status === "revealed" ? "revealed" : "pending",
    };

    if (existing) {
      const { data: row, error } = await supabaseAdmin
        .from("crm_contacts")
        .update({
          first_name: payload.first_name,
          last_name: payload.last_name,
          role: payload.role,
          apollo_person_id: payload.apollo_person_id,
          apollo_reveal_status: payload.apollo_reveal_status,
          linkedin_url: payload.linkedin_url ?? existing.linkedin_url,
        })
        .eq("contact_id", existing.contact_id)
        .select(
          "contact_id, first_name, last_name, role, email, linkedin_url, apollo_person_id, apollo_reveal_status"
        )
        .single();
      if (error) throw new Error(error.message);
      updated++;
      contacts.push(row as SyncedApolloContact);
    } else {
      const { data: row, error } = await supabaseAdmin
        .from("crm_contacts")
        .insert({
          ...payload,
          email: null,
        })
        .select(
          "contact_id, first_name, last_name, role, email, linkedin_url, apollo_person_id, apollo_reveal_status"
        )
        .single();
      if (error) throw new Error(error.message);
      created++;
      contacts.push(row as SyncedApolloContact);
      byApolloId.set(person.apollo_person_id, row);
    }
  }

  return { created, updated, contacts };
}
