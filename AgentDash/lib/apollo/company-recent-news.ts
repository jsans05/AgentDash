import type { SupabaseClient } from "@supabase/supabase-js";
import { searchNewsForOrganization } from "@/lib/apollo/news";
import type { ApolloNewsArticle } from "@/lib/apollo/org-search-types";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import { logApolloUsage } from "@/lib/apollo/usage";

export async function fetchCompanyRecentNews(
  supabaseAdmin: SupabaseClient,
  opts: { companyId: string; userId: string; perPage?: number }
): Promise<{ articles: ApolloNewsArticle[]; apollo_organization_id: string | null }> {
  const { companyId, userId, perPage = 10 } = opts;

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("apollo_organization_id")
    .eq("company_id", companyId)
    .single();

  let apolloOrgId = company?.apollo_organization_id
    ? String(company.apollo_organization_id)
    : null;

  if (!apolloOrgId) {
    const result = await persistApolloMetadataForCompany(supabaseAdmin, companyId);
    if ("needsConfirmation" in result && result.needsConfirmation) {
      return { articles: [], apollo_organization_id: null };
    }
    apolloOrgId = result.apollo_organization_id;
  }

  if (!apolloOrgId) {
    return { articles: [], apollo_organization_id: null };
  }

  const articles = await searchNewsForOrganization(apolloOrgId, { per_page: perPage });
  await logApolloUsage(supabaseAdmin, {
    user_id: userId,
    endpoint: "news_articles/search",
    company_id: companyId,
  });

  return { articles, apollo_organization_id: apolloOrgId };
}
