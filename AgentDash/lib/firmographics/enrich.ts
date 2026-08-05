import type { SupabaseClient } from "@supabase/supabase-js";
import { searchNewsForOrganization } from "@/lib/apollo/news";
import type { ApolloFundingEvent } from "@/lib/apollo/org-search-types";
import { enrichOrganizationByDomainFull, getOrganizationById } from "@/lib/apollo/organizations";
import type { OrgCandidatePublic } from "@/lib/crm/company-firmographics";
import { COMPANY_FIRMOGRAPHICS_DB_COLUMNS, firmographicsPatchFromPartial, mapCompanyFirmographics, type CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { computeSpendReadiness } from "@/lib/firmographics/spend-readiness";
import { fetchAtsJobSignal } from "@/lib/hiring/ats-jobs";
import { fetchFinnhubMarketData } from "@/lib/market-data/finnhub";
import { fetchMetaAdsSignal } from "@/lib/meta/ads-library";
import { mergeSocialLinks, resolveSocialLinksFromWebsite } from "@/lib/meta/resolve-social";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import { enrichCompanyProfile } from "@/lib/enrichment";
export type FirmographicsEnrichResult = {
  needsConfirmation: true;
  candidates: OrgCandidatePublic[];
  current: OrgCandidatePublic | null;
  match_notes?: string | null;
} | {
  needsConfirmation: false;
  firmographics: CompanyFirmographics;
  patched: string[];
  apollo_organization_id: string | null;
  match_confidence: string | null;
  match_notes: string | null;
};
type ApolloEnrichedOrg = Awaited<ReturnType<typeof enrichOrganizationByDomainFull>>;
async function fetchApolloOrgById(apolloOrgId: string, userId?: string, supabaseAdmin?: SupabaseClient) {
  const enriched = await getOrganizationById(apolloOrgId);
  if (userId && supabaseAdmin) {
    await logApolloUsage(supabaseAdmin, {
      user_id: userId,
      endpoint: "organizations/{id}"
    });
  }
  return enriched;
}
async function enrichApolloFromDomain(domain: string, userId?: string, supabaseAdmin?: SupabaseClient): Promise<ApolloEnrichedOrg> {
  const enriched = await enrichOrganizationByDomainFull(domain);
  if (userId && supabaseAdmin) {
    await logApolloUsage(supabaseAdmin, {
      user_id: userId,
      endpoint: "organizations/enrich"
    });
  }
  return enriched;
}
async function buildSecondarySignals(opts: {
  brandName: string;
  domain: string | null;
  website: string | null;
  instagramUrl?: string | null;
  facebookPageUrl?: string | null;
  firmographics: CompanyFirmographics;
  latestFundingRoundDate?: string | null;
}) {
  const website = opts.website ?? (opts.domain ? `https://${opts.domain}` : null);
  const [websiteSocial, tavilySocial, market, jobs] = await Promise.all([resolveSocialLinksFromWebsite(website, opts.brandName), enrichCompanyProfile(opts.brandName).catch(() => ({
    website: null,
    instagram_url: null,
    support_email: null,
    raw_snippets: []
  })), fetchFinnhubMarketData({
    domain: opts.domain,
    companyName: opts.brandName,
    ticker: opts.firmographics.stock_symbol_override ?? undefined
  }), fetchAtsJobSignal(opts.domain)]);
  const social = mergeSocialLinks(opts.brandName, websiteSocial, {
    instagram_url: opts.instagramUrl ?? tavilySocial.instagram_url,
    instagram_handle: opts.instagramUrl ?? undefined,
    facebook_page_url: opts.facebookPageUrl ?? undefined
  });
  const metaWithPage = await fetchMetaAdsSignal({
    brandName: opts.brandName,
    website,
    instagramHandle: social.instagram_handle,
    facebookPageUrl: social.facebook_page_url,
    existingPageId: opts.firmographics.meta_page_id
  });
  const partialFirmographics: Partial<CompanyFirmographics> = {
    ...opts.firmographics,
    domain: opts.domain,
    ticker: market.ticker,
    stock_symbol: market.stock_symbol,
    exchange: market.exchange,
    stock_currency: market.stock_currency,
    market_cap: market.market_cap,
    share_price: market.share_price,
    share_price_change_pct: market.share_price_change_pct,
    stock_change_5d_pct: market.stock_change_5d_pct,
    stock_change_3m_pct: market.stock_change_3m_pct,
    stock_change_12m_pct: market.stock_change_12m_pct,
    stock_52w_high: market.stock_52w_high,
    stock_52w_low: market.stock_52w_low,
    stock_beta: market.stock_beta,
    stock_sparkline: market.stock_sparkline,
    market_data_as_of: market.market_data_as_of,
    open_jobs_count: jobs.open_jobs_count,
    open_jobs_source: jobs.open_jobs_source,
    open_jobs_as_of: jobs.open_jobs_as_of,
    instagram_handle: social.instagram_handle,
    facebook_page_url: metaWithPage.facebook_page_url ?? social.facebook_page_url,
    meta_page_id: metaWithPage.meta_page_id,
    meta_ads_library_url: metaWithPage.meta_ads_library_url,
    meta_ads_latest_start: metaWithPage.meta_ads_latest_start,
    meta_ads_active_count: metaWithPage.meta_ads_active_count,
    meta_ads_status: metaWithPage.meta_ads_status,
    meta_ads_as_of: metaWithPage.meta_ads_as_of
  };
  const spend = computeSpendReadiness({
    firmographics: mapCompanyFirmographics(partialFirmographics),
    latestFundingRoundDate: opts.latestFundingRoundDate,
    openJobsCount: jobs.open_jobs_count,
    sharePriceChangePct: market.share_price_change_pct,
    metaAdsStatus: metaWithPage.meta_ads_status,
    metaAdsActiveCount: metaWithPage.meta_ads_active_count
  });
  return {
    ...partialFirmographics,
    spend_readiness_score: spend.spend_readiness_score,
    spend_readiness_label: spend.spend_readiness_label
  };
}
export async function enrichFirmographicsFromApolloOrg(opts: {
  apolloOrgId: string;
  domain: string | null;
  brandName: string;
  website?: string | null;
  matchConfidence?: string | null;
  matchNotes?: string | null;
  userId?: string;
  supabaseAdmin?: SupabaseClient;
}): Promise<Partial<CompanyFirmographics> & {
  funding_events?: ApolloFundingEvent[];
  industry?: string | null;
}> {
  let enriched = opts.domain ? await enrichApolloFromDomain(opts.domain, opts.userId, opts.supabaseAdmin) : null;
  if (!enriched?.apollo_organization_id || enriched.apollo_organization_id !== opts.apolloOrgId) {
    const byId = await fetchApolloOrgById(opts.apolloOrgId, opts.userId, opts.supabaseAdmin);
    if (opts.domain) {
      enriched = await enrichApolloFromDomain(opts.domain, opts.userId, opts.supabaseAdmin);
    }
    enriched = {
      ...(enriched ?? {} as ApolloEnrichedOrg),
      apollo_organization_id: opts.apolloOrgId,
      headcount_six_month_growth: byId.headcount_six_month_growth,
      headcount_twelve_month_growth: byId.headcount_twelve_month_growth,
      headcount_twenty_four_month_growth: byId.headcount_twenty_four_month_growth,
      departmental_head_count: byId.departmental_head_count,
      estimated_num_employees: byId.estimated_num_employees
    } as ApolloEnrichedOrg;
  }
  let headcountSix = enriched.headcount_six_month_growth;
  let headcountTwelve = enriched.headcount_twelve_month_growth;
  let headcountTwentyFour = enriched.headcount_twenty_four_month_growth;
  let departmentalHeadCount = enriched.departmental_head_count;
  let estimatedEmployees = enriched.estimated_num_employees;
  if (headcountSix == null || headcountTwelve == null || headcountTwentyFour == null || !departmentalHeadCount) {
    const trends = await fetchApolloOrgById(opts.apolloOrgId, opts.userId, opts.supabaseAdmin);
    headcountSix = trends.headcount_six_month_growth ?? headcountSix;
    headcountTwelve = trends.headcount_twelve_month_growth ?? headcountTwelve;
    headcountTwentyFour = trends.headcount_twenty_four_month_growth ?? headcountTwentyFour;
    departmentalHeadCount = trends.departmental_head_count ?? departmentalHeadCount;
    estimatedEmployees = trends.estimated_num_employees ?? estimatedEmployees;
  }
  const resolvedDomain = opts.domain ?? domainFromWebsite(enriched.website) ?? enriched.primary_domain ?? null;
  const baseFirmographics: Partial<CompanyFirmographics> = {
    annual_revenue: enriched.annual_revenue,
    annual_revenue_printed: enriched.annual_revenue_printed,
    total_funding: enriched.total_funding,
    total_funding_printed: enriched.total_funding_printed,
    latest_funding_stage: enriched.latest_funding_stage,
    latest_funding_round_date: enriched.latest_funding_round_date,
    estimated_num_employees: estimatedEmployees,
    headcount_six_month_growth: headcountSix,
    headcount_twelve_month_growth: headcountTwelve,
    headcount_twenty_four_month_growth: headcountTwentyFour,
    departmental_head_count: departmentalHeadCount,
    domain: resolvedDomain,
    match_confidence: opts.matchConfidence ?? null,
    match_notes: opts.matchNotes ?? null
  };
  const signals = await buildSecondarySignals({
    brandName: opts.brandName,
    domain: resolvedDomain,
    website: opts.website ?? enriched.website,
    firmographics: mapCompanyFirmographics(baseFirmographics),
    latestFundingRoundDate: enriched.latest_funding_round_date
  });
  return {
    ...signals,
    funding_events: enriched.funding_events,
    industry: enriched.industry
  };
}
export async function persistCompanyFirmographicsEnrich(supabaseAdmin: SupabaseClient, companyId: string, opts: {
  force?: boolean;
  apollo_organization_id?: string | null;
  candidates?: OrgCandidatePublic[];
  current?: OrgCandidatePublic | null;
  userId?: string;
}): Promise<FirmographicsEnrichResult> {
  const {
    data: company,
    error
  } = await supabaseAdmin.from("companies").select("company_id, name, website, industry, apollo_organization_id, instagram_url, match_confidence, match_notes").eq("company_id", companyId).single();
  if (error || !company) {
    throw new Error(error?.message ?? "Company not found");
  }
  const domain = domainFromWebsite(company.website);
  const chosenOrgId = opts.apollo_organization_id ?? company.apollo_organization_id ?? null;
  if (!opts.apollo_organization_id && !opts.force) {
    const candidate = opts.current ?? opts.candidates?.[0] ?? null;
    if (candidate && candidate.match_confidence !== "high") {
      return {
        needsConfirmation: true,
        candidates: opts.candidates ?? [],
        current: opts.current ?? candidate,
        match_notes: candidate.match_confidence === "low" ? "Low-confidence match — confirm the correct Apollo company before enriching." : "Confirm the Apollo company before enriching."
      };
    }
  }
  let resolvedOrgId = chosenOrgId;
  let matchConfidence = company.match_confidence ?? opts.current?.match_confidence ?? null;
  let matchNotes = company.match_notes ?? null;
  if (!matchNotes && opts.current) {
    matchNotes = opts.current.match_confidence === "high" && domain ? `Matched by website domain (${domain})` : `Matched "${opts.current.name}"`;
  }
  if (!resolvedOrgId && domain) {
    const enriched = await enrichApolloFromDomain(domain, opts.userId, supabaseAdmin);
    resolvedOrgId = enriched.apollo_organization_id;
    matchConfidence = "high";
    matchNotes = `Matched by website domain (${domain})`;
  }
  if (!resolvedOrgId) {
    return {
      needsConfirmation: true,
      candidates: opts.candidates ?? [],
      current: opts.current ?? null,
      match_notes: "Could not resolve Apollo organization — pick the correct company."
    };
  }
  const partial = await enrichFirmographicsFromApolloOrg({
    apolloOrgId: resolvedOrgId,
    domain,
    brandName: String(company.name ?? ""),
    website: company.website,
    matchConfidence: matchConfidence,
    matchNotes: matchNotes,
    userId: opts.userId,
    supabaseAdmin
  });
  const patch: Record<string, unknown> = {
    apollo_organization_id: resolvedOrgId,
    ...firmographicsPatchFromPartial(partial)
  };
  if (!company.industry?.trim() && partial.latest_funding_stage) {
    // industry may come from Apollo org enrich in partial - skip if not present
  }
  if (partial.instagram_handle && !company.instagram_url) {
    patch.instagram_url = `https://www.instagram.com/${partial.instagram_handle.replace(/^@/, "")}/`;
  }
  await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
  const {
    data: updated
  } = await supabaseAdmin.from("companies").select(COMPANY_FIRMOGRAPHICS_DB_COLUMNS).eq("company_id", companyId).single();
  return {
    needsConfirmation: false,
    firmographics: mapCompanyFirmographics(updated ?? null),
    patched: Object.keys(patch),
    apollo_organization_id: resolvedOrgId,
    match_confidence: matchConfidence,
    match_notes: matchNotes
  };
}
export async function fetchApolloNewsForOrg(apolloOrgId: string, userId?: string, supabaseAdmin?: SupabaseClient) {
  const articles = await searchNewsForOrganization(apolloOrgId, {
    per_page: 10
  });
  if (userId && supabaseAdmin) {
    await logApolloUsage(supabaseAdmin, {
      user_id: userId,
      endpoint: "news_articles/search"
    });
  }
  return articles;
}