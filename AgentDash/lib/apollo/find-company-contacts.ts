import type { SupabaseClient } from "@supabase/supabase-js";
import { isApolloEnabled } from "@/lib/apollo/config";
import { resolveOrganizationForCompany, filterPeopleForResolvedOrg } from "@/lib/apollo/resolve-organization";
import { searchPeopleAtOrganization } from "@/lib/apollo/people-search";
import type { ApolloContactSearchMode, ApolloPeopleSearchOverrides } from "@/lib/apollo/search-defaults";
import { upsertApolloPendingContacts } from "@/lib/apollo/sync-contacts";
import { logApolloUsage } from "@/lib/apollo/usage";

export async function findContactsForCompany(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    overrides?: ApolloPeopleSearchOverrides;
    searchMode?: ApolloContactSearchMode;
    consultingProfileId?: string | null;
  }
) {
  if (!isApolloEnabled()) {
    throw new Error("Apollo API is not configured");
  }

  const requestedSearchMode: ApolloContactSearchMode = params.searchMode ?? "partnership";
  const org = await resolveOrganizationForCompany(supabaseAdmin, params.companyId);

  let searchMode = requestedSearchMode;
  let partnershipFallbackUsed = false;
  let rawPeople = await searchPeopleAtOrganization(org, {
    searchMode: requestedSearchMode,
    overrides: params.overrides,
  });
  let people = filterPeopleForResolvedOrg(rawPeople, org);

  await logApolloUsage(supabaseAdmin, {
    user_id: params.userId,
    endpoint: "api_search",
    company_id: params.companyId,
  });

  if (people.length === 0 && requestedSearchMode === "partnership") {
    const fallbackRaw = await searchPeopleAtOrganization(org, {
      searchMode: "all_verified",
      overrides: params.overrides,
    });
    const fallbackPeople = filterPeopleForResolvedOrg(fallbackRaw, org);
    await logApolloUsage(supabaseAdmin, {
      user_id: params.userId,
      endpoint: "api_search",
      company_id: params.companyId,
    });
    partnershipFallbackUsed = true;
    searchMode = "all_verified";
    rawPeople = fallbackRaw;
    people = fallbackPeople;
  }

  const sync = await upsertApolloPendingContacts(supabaseAdmin, {
    userId: params.userId,
    companyId: params.companyId,
    people,
    consultingProfileId: params.consultingProfileId,
  });

  let contactsQuery = supabaseAdmin
    .from("crm_contacts")
    .select(
      "contact_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status, apollo_phone_reveal_status"
    )
    .eq("company_id", params.companyId)
    .eq("archived", false)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (params.consultingProfileId) {
    contactsQuery = contactsQuery.eq("consulting_profile_id", params.consultingProfileId);
  } else {
    contactsQuery = contactsQuery.eq("created_by_user_id", params.userId);
  }

  const { data: allContacts, error: listErr } = await contactsQuery;

  if (listErr) throw new Error(listErr.message);

  const { data: companyRow, error: companyErr } = await supabaseAdmin
    .from("companies")
    .select("hq_phone")
    .eq("company_id", params.companyId)
    .single();
  if (companyErr) throw new Error(companyErr.message);

  return {
    organization: org,
    search_mode: searchMode,
    requested_search_mode: requestedSearchMode,
    partnership_fallback_used: partnershipFallbackUsed,
    found: people.length,
    filtered_out: rawPeople.length - people.length,
    no_matches: people.length === 0,
    created: sync.created,
    updated: sync.updated,
    contacts: allContacts ?? [],
    hq_phone: companyRow?.hq_phone != null ? String(companyRow.hq_phone) : null,
    page: params.overrides?.page ?? 1,
  };
}
