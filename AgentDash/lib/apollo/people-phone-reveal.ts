import { fetchApollo } from "@/lib/apollo/client";
import { extractPersonSyncPhone, pickBestContactPhone, type ApolloPhoneNumberEntry } from "@/lib/apollo/phone-utils";

type PeopleMatchResponse = {
  person?: Record<string, unknown>;
};

type PhoneWebhookPayload = {
  status?: string;
  people?: Array<{
    id?: string;
    status?: string;
    phone_numbers?: ApolloPhoneNumberEntry[];
  }>;
};

export async function requestPersonPhoneReveal(params: {
  apollo_person_id?: string | null;
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  domain?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  webhook_url: string;
}): Promise<{ work_phone: string | null; apollo_person_id: string | null }> {
  const query: Record<string, string | number | boolean | undefined> = {
    reveal_phone_number: true,
    webhook_url: params.webhook_url,
  };

  if (params.apollo_person_id) query.id = params.apollo_person_id;
  if (params.first_name) query.first_name = params.first_name;
  if (params.last_name) query.last_name = params.last_name;
  if (params.organization_name) query.organization_name = params.organization_name;
  if (params.domain) query.domain = params.domain;
  if (params.linkedin_url) query.linkedin_url = params.linkedin_url;
  if (params.email) query.email = params.email;

  const data = await fetchApollo<PeopleMatchResponse>("/people/match", { query });
  const person = data.person;
  const apollo_person_id =
    person && typeof person === "object" && person.id != null
      ? String(person.id).trim() || params.apollo_person_id || null
      : params.apollo_person_id ?? null;

  return {
    work_phone: extractPersonSyncPhone(person),
    apollo_person_id,
  };
}

export function parsePhoneFromWebhookPayload(
  payload: unknown,
  apolloPersonId: string
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as PhoneWebhookPayload;

  const people = Array.isArray(body.people) ? body.people : [];
  const match =
    people.find((p) => String(p.id ?? "") === apolloPersonId) ??
    people.find((p) => p.status === "success") ??
    people[0];

  if (!match || !Array.isArray(match.phone_numbers)) return null;
  return pickBestContactPhone(match.phone_numbers);
}
