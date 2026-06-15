import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomainFull } from "@/lib/apollo/organizations";
import { resolveOrganizationForCompany } from "@/lib/apollo/resolve-organization";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import { loadCompanyOrgRow } from "@/lib/apollo/org-candidates";

export async function enrichCompanyHqPhone(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    /** When true, overwrite an existing hq_phone value. Default: only fill blanks. */
    overwrite?: boolean;
  }
) {
  const company = await loadCompanyOrgRow(supabaseAdmin, params.companyId);
  const resolved = await resolveOrganizationForCompany(supabaseAdmin, params.companyId);
  const domain = resolved.domain ?? domainFromWebsite(company.website);

  if (!domain) {
    throw new Error("Company website is required to pull HQ phone from Apollo");
  }

  const enriched = await enrichOrganizationByDomainFull(domain);
  const hqPhone = enriched.hq_phone;

  await logApolloUsage(supabaseAdmin, {
    user_id: params.userId,
    endpoint: "organizations/enrich",
    company_id: params.companyId,
  });

  if (!hqPhone) {
    return {
      company_id: params.companyId,
      hq_phone: company.hq_phone ?? null,
      updated: false,
      found: false,
      domain,
    };
  }

  const shouldWrite = params.overwrite || !company.hq_phone;
  if (shouldWrite) {
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ hq_phone: hqPhone })
      .eq("company_id", params.companyId);
    if (error) throw new Error(error.message);
  }

  return {
    company_id: params.companyId,
    hq_phone: shouldWrite ? hqPhone : company.hq_phone ?? hqPhone,
    updated: shouldWrite,
    found: true,
    domain,
    skipped_existing: !shouldWrite && Boolean(company.hq_phone),
  };
}
