import type { SupabaseClient } from "@supabase/supabase-js";
import { isApolloEnabled } from "@/lib/apollo/config";
import {
  loadCompanyOrgRow,
  searchApolloOrganizationsForCompany,
} from "@/lib/apollo/org-candidates";
import { orgMatchConfidence, pickBestApolloOrganization } from "@/lib/apollo/org-match-scoring";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";

export type EnsureCompanyWebsiteResult = {
  website: string | null;
  apollo_organization_id: string | null;
  source: "existing" | "apollo" | "none";
};

function websiteFromBest(org: {
  website?: string;
  primary_domain?: string;
}): string | null {
  const raw = org.website?.trim();
  if (raw) return raw;
  const domain = org.primary_domain?.trim();
  if (!domain) return null;
  return domain.startsWith("http") ? domain : `https://${domain.replace(/^www\./i, "")}`;
}

export async function ensureCompanyWebsite(
  supabaseAdmin: SupabaseClient,
  companyId: string,
  ctx: {
    companyName: string;
    productCategory?: string | null;
    industry?: string | null;
  },
  opts?: { userId?: string | null }
): Promise<EnsureCompanyWebsiteResult> {
  const { data: row, error } = await supabaseAdmin
    .from("companies")
    .select("website, apollo_organization_id, product_category, industry")
    .eq("company_id", companyId)
    .single();

  if (error) throw new Error(error.message);

  const existingWebsite = row?.website ? String(row.website).trim() : "";
  if (existingWebsite) {
    return {
      website: existingWebsite,
      apollo_organization_id: row?.apollo_organization_id
        ? String(row.apollo_organization_id)
        : null,
      source: "existing",
    };
  }

  if (!isApolloEnabled()) {
    return { website: null, apollo_organization_id: null, source: "none" };
  }

  const company = await loadCompanyOrgRow(supabaseAdmin, companyId);
  const matchContext = {
    companyName: ctx.companyName.trim() || company.name,
    productCategory: ctx.productCategory ?? company.product_category,
    industry: ctx.industry ?? company.industry,
  };

  const organizations = await searchApolloOrganizationsForCompany(company);
  const best = pickBestApolloOrganization(organizations, matchContext);
  if (!best?.apollo_organization_id) {
    return { website: null, apollo_organization_id: null, source: "none" };
  }

  const website = websiteFromBest(best);
  const domain = domainFromWebsite(website);
  const confidence = orgMatchConfidence(best, matchContext, false);
  if (!domain && confidence === "low") {
    return { website: null, apollo_organization_id: null, source: "none" };
  }

  const patch: Record<string, string> = {};
  if (website) patch.website = website;
  if (best.apollo_organization_id && !row?.apollo_organization_id) {
    patch.apollo_organization_id = best.apollo_organization_id;
  }

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabaseAdmin
      .from("companies")
      .update(patch)
      .eq("company_id", companyId);
    if (upErr) throw new Error(upErr.message);
  }

  if (opts?.userId) {
    await logApolloUsage(supabaseAdmin, {
      user_id: opts.userId,
      endpoint: "mixed_companies/search",
      company_id: companyId,
    });
  }

  return {
    website: website ?? null,
    apollo_organization_id: best.apollo_organization_id,
    source: "apollo",
  };
}
