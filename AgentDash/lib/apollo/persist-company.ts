import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomain } from "@/lib/apollo/organizations";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";

/** Persist Apollo org id and industry/website from domain enrich when missing on companies row. */
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

  const enriched = await enrichOrganizationByDomain(domain);
  const patch: Record<string, string> = {};
  if (enriched.apollo_organization_id) {
    patch.apollo_organization_id = enriched.apollo_organization_id;
  }
  if (!company.industry?.trim() && enriched.industry) {
    patch.industry = enriched.industry;
  }
  if (!company.website?.trim() && enriched.website) {
    patch.website = enriched.website;
  }

  if (Object.keys(patch).length > 0) {
    await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
  }

  return {
    apollo_organization_id: patch.apollo_organization_id ?? company.apollo_organization_id ?? null,
    patched: Object.keys(patch),
  };
}
