import { fetchApollo } from "@/lib/apollo/client";
import type { ApolloMatchResult } from "@/lib/apollo/types";

type PeopleMatchResponse = {
  person?: Record<string, unknown>;
};

function str(v: unknown): string | null {
  const s = v != null ? String(v).trim() : "";
  return s || null;
}

export async function matchPerson(params: {
  apollo_person_id?: string | null;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  domain?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
}): Promise<ApolloMatchResult> {
  const query: Record<string, string | number | boolean | string[] | undefined> = {};

  if (params.apollo_person_id) query.id = params.apollo_person_id;
  if (params.first_name) query.first_name = params.first_name;
  if (params.last_name) query.last_name = params.last_name;
  if (params.organization_name) query.organization_name = params.organization_name;
  if (params.domain) query.domain = params.domain;
  if (params.linkedin_url) query.linkedin_url = params.linkedin_url;
  if (params.email) query.email = params.email;

  const data = await fetchApollo<PeopleMatchResponse>("/people/match", { query });
  const person = data.person;
  if (!person || typeof person !== "object") {
    return {
      apollo_person_id: params.apollo_person_id ?? null,
      email: null,
      linkedin_url: null,
      first_name: params.first_name ?? null,
      last_name: params.last_name ?? null,
      title: null,
    };
  }

  const email =
    str(person.email) ??
    str(person.corporate_email) ??
    str(person.work_email) ??
    (Array.isArray(person.emails) && person.emails[0] && typeof person.emails[0] === "object"
      ? str((person.emails[0] as Record<string, unknown>).email)
      : null);

  return {
    apollo_person_id: str(person.id) ?? params.apollo_person_id ?? null,
    email,
    linkedin_url: str(person.linkedin_url),
    first_name: str(person.first_name) ?? params.first_name ?? null,
    last_name: str(person.last_name) ?? params.last_name ?? null,
    title: str(person.title),
  };
}
