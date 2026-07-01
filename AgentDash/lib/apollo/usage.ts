import type { SupabaseClient } from "@supabase/supabase-js";

export async function logApolloUsage(
  supabaseAdmin: SupabaseClient,
  entry: {
    user_id: string;
    endpoint:
      | "api_search"
      | "people/match"
      | "mixed_companies/search"
      | "organizations/enrich"
      | "organizations/{id}"
      | "news_articles/search";
    company_id?: string | null;
    apollo_person_id?: string | null;
  }
) {
  await supabaseAdmin.from("apollo_api_usage").insert({
    user_id: entry.user_id,
    endpoint: entry.endpoint,
    company_id: entry.company_id ?? null,
    apollo_person_id: entry.apollo_person_id ?? null,
  });
}
