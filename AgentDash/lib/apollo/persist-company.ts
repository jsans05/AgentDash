import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomainFull } from "@/lib/apollo/organizations";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { firmographicsPatchFromPartial } from "@/lib/crm/company-firmographics";

/** Persist Apollo org id, industry/website, and firmographics from domain enrich when missing. */
export async function persistApolloMetadataForCompany(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  opts?: { website?: string | null; force?: boolean }
): Promise<{ apollo_organization_id: string | null; patched: string[] }> {
  const { data: company, error } = await supabaseAdmin
    .from("companies")
    .select("company_id, name, website, industry, apollo_organization_id")
    .eq("company_id", companyId)
    .single();

  if (error || !company) {
    throw new Error(error?.message ?? "Company not found");
  }

  if (company.apollo_organization_id && !opts?.force) {
    return { apollo_organization_id: String(company.apollo_organization_id), patched: [] };
  }

  const website = opts?.website ?? company.website;
  const domain = domainFromWebsite(website);
  if (!domain) {
    return { apollo_organization_id: company.apollo_organization_id ?? null, patched: [] };
  }

  const enriched = await enrichOrganizationByDomainFull(domain);
  const patch: Record<string, string | number | null> = {};
  if (enriched.apollo_organization_id) {
    patch.apollo_organization_id = enriched.apollo_organization_id;
  }
  if (!company.industry?.trim() && enriched.industry) {
    patch.industry = enriched.industry;
  }
  if (!company.website?.trim() && enriched.website) {
    patch.website = enriched.website;
  }

  Object.assign(
    patch,
    firmographicsPatchFromPartial({
      annual_revenue: enriched.annual_revenue,
      annual_revenue_printed: enriched.annual_revenue_printed,
      total_funding: enriched.total_funding,
      total_funding_printed: enriched.total_funding_printed,
      latest_funding_stage: enriched.latest_funding_stage,
      estimated_num_employees: enriched.estimated_num_employees,
      headcount_six_month_growth: enriched.headcount_six_month_growth,
      headcount_twelve_month_growth: enriched.headcount_twelve_month_growth,
      headcount_twenty_four_month_growth: enriched.headcount_twenty_four_month_growth,
    })
  );

  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
  }

  return {
    apollo_organization_id: patch.apollo_organization_id ?? company.apollo_organization_id ?? null,
    patched: Object.keys(patch),
  };
}
