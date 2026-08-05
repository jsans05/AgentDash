import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomainFull, searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
import {
  orgMatchConfidence,
  pickBestApolloOrganization,
  scoreApolloOrganizationCandidate,
  type OrgMatchContext,
} from "@/lib/apollo/org-match-scoring";
import type { ApolloOrganizationResult } from "@/lib/apollo/org-search-types";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import type { OrgCandidatePublic } from "@/lib/crm/company-firmographics";
import type { AggregatedBrand } from "@/lib/market-intel/queries";
import { resolveBrandDomain } from "@/lib/market-intel/enrich-brand";

export type BrandOrgContext = {
  brandKey: string;
  displayName: string;
  domain: string | null;
  apollo_organization_id: string | null;
};

export async function loadBrandOrgContext(
  supabaseAdmin: SupabaseClient,
  brand: AggregatedBrand
): Promise<BrandOrgContext> {
  const { data } = await supabaseAdmin
    .from("market_intel_brand_enrichment")
    .select("apollo_organization_id, domain")
    .eq("company_name_normalized", brand.key)
    .maybeSingle();

  return {
    brandKey: brand.key,
    displayName: brand.displayName,
    domain: data?.domain ?? resolveBrandDomain(brand),
    apollo_organization_id: data?.apollo_organization_id
      ? String(data.apollo_organization_id)
      : null,
  };
}

function brandMatchContext(ctx: BrandOrgContext): OrgMatchContext {
  return {
    companyName: ctx.displayName,
    productCategory: null,
    industry: null,
  };
}

async function searchApolloOrganizationsForBrand(
  ctx: BrandOrgContext
): Promise<ApolloOrganizationResult[]> {
  const { organizations } = await searchApolloOrganizationsAdvanced({
    q_organization_name: ctx.displayName,
    per_page: 15,
  });
  return organizations;
}

function orgToCandidate(
  org: ApolloOrganizationResult,
  matchCtx: OrgMatchContext,
  resolvedViaDomain: boolean,
  selected: boolean
): OrgCandidatePublic | null {
  const id = org.apollo_organization_id;
  if (!id) return null;
  return {
    apollo_organization_id: id,
    name: org.name,
    website: org.website ?? null,
    industry: org.industry ?? null,
    description: org.description ?? null,
    score: scoreApolloOrganizationCandidate(org, matchCtx),
    primary_domain: org.primary_domain ?? null,
    match_confidence: orgMatchConfidence(org, matchCtx, resolvedViaDomain),
    selected,
  };
}

export async function listBrandOrganizationCandidates(
  supabaseAdmin: SupabaseClient,
  brand: AggregatedBrand,
  userId?: string
): Promise<{
  brand_key: string;
  brand_name: string;
  current: OrgCandidatePublic | null;
  candidates: OrgCandidatePublic[];
  best: OrgCandidatePublic | null;
}> {
  const ctx = await loadBrandOrgContext(supabaseAdmin, brand);
  const matchCtx = brandMatchContext(ctx);
  const storedId = ctx.apollo_organization_id;
  const domain = ctx.domain ?? resolveBrandDomain(brand);

  let domainOrg: ApolloOrganizationResult | null = null;
  if (domain) {
    const enriched = await enrichOrganizationByDomainFull(domain);
    if (userId) {
      await logApolloUsage(supabaseAdmin, {
        user_id: userId,
        endpoint: "organizations/enrich",
      });
    }
    if (enriched.apollo_organization_id) {
      domainOrg = {
        apollo_organization_id: enriched.apollo_organization_id,
        name: enriched.name ?? ctx.displayName,
        industry: enriched.industry ?? undefined,
        website: enriched.website ?? undefined,
        primary_domain: domain,
      };
    }
  }

  const searched = await searchApolloOrganizationsForBrand(ctx);
  if (userId) {
    await logApolloUsage(supabaseAdmin, {
      user_id: userId,
      endpoint: "mixed_companies/search",
    });
  }

  const merged = new Map<string, ApolloOrganizationResult>();
  for (const org of searched) {
    if (org.apollo_organization_id) merged.set(org.apollo_organization_id, org);
  }
  if (domainOrg?.apollo_organization_id) {
    merged.set(domainOrg.apollo_organization_id, domainOrg);
  }

  const organizations = [...merged.values()];
  const bestOrg = pickBestApolloOrganization(organizations, matchCtx);
  const candidates = organizations
    .map((org) =>
      orgToCandidate(
        org,
        matchCtx,
        Boolean(domain && org.apollo_organization_id === domainOrg?.apollo_organization_id),
        storedId != null && org.apollo_organization_id === storedId
      )
    )
    .filter((c): c is OrgCandidatePublic => c != null)
    .sort((a, b) => b.score - a.score);

  const best =
    bestOrg != null
      ? candidates.find((c) => c.apollo_organization_id === bestOrg.apollo_organization_id) ??
        orgToCandidate(bestOrg, matchCtx, Boolean(domainOrg), false)
      : null;

  const current =
    storedId != null
      ? candidates.find((c) => c.apollo_organization_id === storedId) ?? null
      : domainOrg?.apollo_organization_id
        ? candidates.find((c) => c.apollo_organization_id === domainOrg.apollo_organization_id) ??
          orgToCandidate(domainOrg, matchCtx, true, true)
        : best;

  return {
    brand_key: ctx.brandKey,
    brand_name: ctx.displayName,
    current: current ?? null,
    candidates,
    best: best ?? null,
  };
}

export async function selectBrandOrganization(
  supabaseAdmin: SupabaseClient,
  params: {
    brand: AggregatedBrand;
    apollo_organization_id: string;
    userId: string;
  }
): Promise<{ match_confidence: string; match_notes: string; domain: string | null }> {
  const ctx = await loadBrandOrgContext(supabaseAdmin, params.brand);
  const matchCtx = brandMatchContext(ctx);
  const targetId = String(params.apollo_organization_id).trim();
  if (!targetId) throw new Error("apollo_organization_id is required");

  const { candidates } = await listBrandOrganizationCandidates(supabaseAdmin, params.brand);
  let picked = candidates.find((c) => c.apollo_organization_id === targetId);

  if (!picked) {
    const searched = await searchApolloOrganizationsForBrand(ctx);
    const org = searched.find((o) => o.apollo_organization_id === targetId);
    if (org) {
      const row = orgToCandidate(org, matchCtx, false, true);
      if (row) picked = row;
    }
  }

  if (!picked) {
    throw new Error("Organization not found in Apollo search results for this brand");
  }

  const domain =
    domainFromWebsite(picked.website) ??
    (picked.primary_domain ? picked.primary_domain.replace(/^www\./i, "") : null);

  await supabaseAdmin.from("market_intel_brand_enrichment").upsert(
    {
      company_name_normalized: params.brand.key,
      display_name: params.brand.displayName,
      domain,
      apollo_organization_id: targetId,
      match_confidence: picked.match_confidence,
      match_notes: `Using Apollo org "${picked.name}" (selected manually)`,
    },
    { onConflict: "company_name_normalized" }
  );

  await logApolloUsage(supabaseAdmin, {
    user_id: params.userId,
    endpoint: "mixed_companies/search",
  });

  return {
    match_confidence: picked.match_confidence,
    match_notes: `Using Apollo org "${picked.name}" (selected manually)`,
    domain,
  };
}

export function shouldAutoEnrichOrg(candidate: OrgCandidatePublic | null): boolean {
  return candidate?.match_confidence === "high";
}
