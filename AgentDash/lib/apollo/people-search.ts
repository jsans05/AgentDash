import { fetchApollo } from "@/lib/apollo/client";
import { apolloMaxPeoplePerRequest } from "@/lib/apollo/config";
import {
  APOLLO_DEFAULT_CONTACT_EMAIL_STATUS,
  APOLLO_DEFAULT_INCLUDE_SIMILAR_TITLES,
  APOLLO_DEFAULT_PERSON_SENIORITIES,
  APOLLO_DEFAULT_PERSON_TITLES,
  type ApolloContactSearchMode,
  type ApolloPeopleSearchOverrides,
} from "@/lib/apollo/search-defaults";
import type { ApolloSearchPerson } from "@/lib/apollo/types";
import type { ResolvedOrganization } from "@/lib/apollo/types";

type PeopleSearchResponse = {
  people?: Array<Record<string, unknown>>;
  pagination?: { page?: number; per_page?: number; total_entries?: number };
};

function mapPerson(raw: Record<string, unknown>, organizationName: string): ApolloSearchPerson | null {
  const id = raw.id != null ? String(raw.id) : "";
  const first_name = String(raw.first_name ?? "").trim();
  if (!id || !first_name) return null;

  const last_name =
    typeof raw.last_name === "string" && raw.last_name.trim()
      ? raw.last_name.trim()
      : typeof raw.last_name_obfuscated === "string" && raw.last_name_obfuscated.trim()
        ? raw.last_name_obfuscated.trim()
        : "";

  const org =
    raw.organization && typeof raw.organization === "object"
      ? (raw.organization as Record<string, unknown>)
      : null;

  const linkedin_url =
    typeof raw.linkedin_url === "string" && raw.linkedin_url.trim()
      ? raw.linkedin_url.trim()
      : typeof org?.linkedin_url === "string"
        ? org.linkedin_url.trim()
        : undefined;

  return {
    apollo_person_id: id,
    first_name,
    last_name,
    title: String(raw.title ?? "").trim(),
    seniority: typeof raw.seniority === "string" ? raw.seniority : undefined,
    organization_name: String(org?.name ?? organizationName).trim() || organizationName,
    linkedin_url,
    email_status:
      typeof raw.email_status === "string"
        ? raw.email_status
        : raw.has_email === true
          ? "verified"
          : undefined,
    has_email: raw.has_email === true,
  };
}

function titleScopeFromSearchMode(mode: ApolloContactSearchMode): "partnership" | "any" {
  return mode === "all_verified" ? "any" : "partnership";
}

export async function searchPeopleAtOrganization(
  org: ResolvedOrganization,
  options?: {
    searchMode?: ApolloContactSearchMode;
    overrides?: ApolloPeopleSearchOverrides;
  }
): Promise<ApolloSearchPerson[]> {
  const searchMode = options?.searchMode ?? "partnership";
  const overrides = options?.overrides;
  const per_page = Math.min(
    overrides?.per_page ?? apolloMaxPeoplePerRequest(),
    apolloMaxPeoplePerRequest()
  );
  const page = overrides?.page ?? 1;

  const query: Record<string, string | number | boolean | string[] | undefined> = {
    contact_email_status: [...APOLLO_DEFAULT_CONTACT_EMAIL_STATUS],
    page,
    per_page,
  };

  if (titleScopeFromSearchMode(searchMode) === "partnership") {
    query.person_titles = [...APOLLO_DEFAULT_PERSON_TITLES];
    query.include_similar_titles = APOLLO_DEFAULT_INCLUDE_SIMILAR_TITLES;
    query.person_seniorities = [...APOLLO_DEFAULT_PERSON_SENIORITIES];
  }

  if (org.domain) {
    query.q_organization_domains_list = [org.domain];
  } else if (org.apollo_organization_id) {
    query.organization_ids = [org.apollo_organization_id];
  }

  if (overrides?.organization_locations?.length) {
    query.organization_locations = overrides.organization_locations;
  }
  if (overrides?.person_locations?.length) {
    query.person_locations = overrides.person_locations;
  }
  if (overrides?.revenue_range_min != null) {
    query["revenue_range[min]"] = overrides.revenue_range_min;
  }
  if (overrides?.revenue_range_max != null) {
    query["revenue_range[max]"] = overrides.revenue_range_max;
  }
  if (overrides?.q_keywords?.trim()) {
    query.q_keywords = overrides.q_keywords.trim();
  }
  if (overrides?.person_titles?.length) {
    query.person_titles = overrides.person_titles;
    query.include_similar_titles = true;
  }
  if (overrides?.person_seniorities?.length) {
    query.person_seniorities = overrides.person_seniorities;
  }
  if (overrides?.person_departments?.length) {
    query.person_department_or_subdepartments = overrides.person_departments;
  }

  const data = await fetchApollo<PeopleSearchResponse>("/mixed_people/api_search", { query });
  const people = Array.isArray(data.people) ? data.people : [];

  const out: ApolloSearchPerson[] = [];
  const seen = new Set<string>();
  for (const raw of people) {
    const mapped = mapPerson(raw, org.company_name);
    if (!mapped || seen.has(mapped.apollo_person_id)) continue;
    seen.add(mapped.apollo_person_id);
    out.push(mapped);
  }
  return out;
}

/** Partnership / marketing titles with verified email (default Find contacts). */
export async function searchPartnershipContacts(
  org: ResolvedOrganization,
  overrides?: ApolloPeopleSearchOverrides
): Promise<ApolloSearchPerson[]> {
  return searchPeopleAtOrganization(org, { searchMode: "partnership", overrides });
}
