import type { SupabaseClient } from "@supabase/supabase-js";
import { isApolloEnabled } from "@/lib/apollo/config";
import {
  listBrandOrganizationCandidates,
  shouldAutoEnrichOrg,
} from "@/lib/apollo/brand-org-candidates";
import type { OrgCandidatePublic } from "@/lib/crm/company-firmographics";
import {
  enrichFirmographicsFromApolloOrg,
  fetchApolloNewsForOrg,
} from "@/lib/firmographics/enrich";
import type { AggregatedBrand, BrandEnrichmentRow } from "@/lib/market-intel/queries";
import { resolveBrandDomain } from "@/lib/market-intel/enrich-brand";

export type BrandEnrichResult =
  | {
      needsConfirmation: true;
      candidates: OrgCandidatePublic[];
      current: OrgCandidatePublic | null;
      match_notes?: string | null;
    }
  | { needsConfirmation: false; enrichment: BrandEnrichmentRow };

export async function prepareBrandEnrich(
  supabaseAdmin: SupabaseClient,
  brand: AggregatedBrand,
  userId: string,
  opts?: { apollo_organization_id?: string | null; force?: boolean }
): Promise<BrandEnrichResult> {
  if (!isApolloEnabled()) {
    throw new Error("Apollo integration is not configured");
  }

  const listed = await listBrandOrganizationCandidates(supabaseAdmin, brand, userId);
  const domain = resolveBrandDomain(brand) ?? listed.current?.primary_domain ?? null;

  const chosenId =
    opts?.apollo_organization_id ??
    (listed.current?.selected ? listed.current.apollo_organization_id : null) ??
    (shouldAutoEnrichOrg(listed.best) ? listed.best?.apollo_organization_id : null);

  if (!opts?.apollo_organization_id && !opts?.force) {
    const candidate = listed.current ?? listed.best;
    if (!shouldAutoEnrichOrg(candidate ?? null) && !chosenId) {
      return {
        needsConfirmation: true,
        candidates: listed.candidates,
        current: listed.current ?? listed.best,
        match_notes:
          candidate?.match_confidence === "low"
            ? "Low-confidence match — confirm the correct Apollo company before enriching."
            : "Confirm the Apollo company before enriching.",
      };
    }
  }

  const resolvedCandidate =
    listed.candidates.find((c) => c.apollo_organization_id === chosenId) ??
    listed.current ??
    listed.best;

  if (!chosenId) {
    return {
      needsConfirmation: true,
      candidates: listed.candidates,
      current: listed.current ?? listed.best,
      match_notes: domain
        ? "Could not auto-match — pick the correct Apollo company."
        : `No website domain found for ${brand.displayName} — pick the correct Apollo company.`,
    };
  }

  const candidateDomain =
    domain ??
    resolvedCandidate?.primary_domain ??
    resolvedCandidate?.website?.replace(/^https?:\/\//i, "").split("/")[0] ??
    null;

  const partial = await enrichFirmographicsFromApolloOrg({
    apolloOrgId: chosenId,
    domain: candidateDomain,
    brandName: brand.displayName,
    website: candidateDomain ? `https://${candidateDomain}` : resolvedCandidate?.website ?? null,
    matchConfidence: resolvedCandidate?.match_confidence ?? "high",
    matchNotes:
      resolvedCandidate?.match_confidence === "high" && domain
        ? `Matched by website domain (${candidateDomain})`
        : resolvedCandidate
          ? `Matched "${resolvedCandidate.name}"`
          : null,
    userId,
    supabaseAdmin,
  });

  const newsArticles = await fetchApolloNewsForOrg(chosenId, userId, supabaseAdmin);

  const row = {
    company_name_normalized: brand.key,
    display_name: brand.displayName,
    domain: partial.domain ?? candidateDomain,
    apollo_organization_id: chosenId,
    annual_revenue: partial.annual_revenue ?? null,
    annual_revenue_printed: partial.annual_revenue_printed ?? null,
    total_funding: partial.total_funding ?? null,
    total_funding_printed: partial.total_funding_printed ?? null,
    latest_funding_stage: partial.latest_funding_stage ?? null,
    latest_funding_round_date: partial.latest_funding_round_date ?? null,
    funding_events: partial.funding_events ?? [],
    estimated_num_employees: partial.estimated_num_employees ?? null,
    industry: partial.industry ?? null,
    headcount_six_month_growth: partial.headcount_six_month_growth ?? null,
    headcount_twelve_month_growth: partial.headcount_twelve_month_growth ?? null,
    headcount_twenty_four_month_growth: partial.headcount_twenty_four_month_growth ?? null,
    departmental_head_count: partial.departmental_head_count ?? null,
    match_confidence: partial.match_confidence ?? null,
    match_notes: partial.match_notes ?? null,
    ticker: partial.ticker ?? null,
    stock_symbol: partial.stock_symbol ?? null,
    stock_symbol_override: partial.stock_symbol_override ?? null,
    exchange: partial.exchange ?? null,
    stock_currency: partial.stock_currency ?? null,
    market_cap: partial.market_cap ?? null,
    share_price: partial.share_price ?? null,
    share_price_change_pct: partial.share_price_change_pct ?? null,
    stock_change_5d_pct: partial.stock_change_5d_pct ?? null,
    stock_change_3m_pct: partial.stock_change_3m_pct ?? null,
    stock_change_12m_pct: partial.stock_change_12m_pct ?? null,
    stock_52w_high: partial.stock_52w_high ?? null,
    stock_52w_low: partial.stock_52w_low ?? null,
    stock_beta: partial.stock_beta ?? null,
    stock_sparkline: partial.stock_sparkline ?? null,
    market_data_as_of: partial.market_data_as_of ?? null,
    open_jobs_count: partial.open_jobs_count ?? null,
    open_jobs_source: partial.open_jobs_source ?? null,
    open_jobs_as_of: partial.open_jobs_as_of ?? null,
    instagram_handle: partial.instagram_handle ?? null,
    facebook_page_url: partial.facebook_page_url ?? null,
    meta_page_id: partial.meta_page_id ?? null,
    meta_ads_library_url: partial.meta_ads_library_url ?? null,
    meta_ads_latest_start: partial.meta_ads_latest_start ?? null,
    meta_ads_active_count: partial.meta_ads_active_count ?? null,
    meta_ads_status: partial.meta_ads_status ?? null,
    meta_ads_as_of: partial.meta_ads_as_of ?? null,
    spend_readiness_score: partial.spend_readiness_score ?? null,
    spend_readiness_label: partial.spend_readiness_label ?? null,
    news_articles: newsArticles,
    enriched_at: new Date().toISOString(),
    enriched_by: userId,
  };

  const { data, error } = await supabaseAdmin
    .from("market_intel_brand_enrichment")
    .upsert(row, { onConflict: "company_name_normalized" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return {
    needsConfirmation: false,
    enrichment: data as BrandEnrichmentRow,
  };
}

export type { OrgCandidatePublic };
