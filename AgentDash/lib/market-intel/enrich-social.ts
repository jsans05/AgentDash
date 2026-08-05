import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichCompanyProfile } from "@/lib/enrichment";
import { fetchMetaAdsSignal } from "@/lib/meta/ads-library";
import { mergeSocialLinks, resolveSocialLinksFromWebsite } from "@/lib/meta/resolve-social";
import { resolveBrandDomain } from "@/lib/market-intel/enrich-brand";
import type { AggregatedBrand, BrandEnrichmentRow } from "@/lib/market-intel/queries";

export type BrandSocialSignals = {
  company_name_normalized: string;
  display_name: string;
  domain: string | null;
  instagram_handle: string | null;
  facebook_page_url: string | null;
  meta_page_id: string | null;
  meta_ads_library_url: string | null;
  meta_ads_latest_start: string | null;
  meta_ads_active_count: number | null;
  meta_ads_status: string | null;
  meta_ads_as_of: string | null;
};

export async function resolveBrandSocialSignals(
  brand: AggregatedBrand
): Promise<BrandSocialSignals> {
  const domain = resolveBrandDomain(brand);
  const website = domain ? `https://${domain}` : null;

  const [websiteSocial, tavilySocial] = await Promise.all([
    resolveSocialLinksFromWebsite(website, brand.displayName),
    enrichCompanyProfile(brand.displayName).catch(() => ({
      website: null,
      instagram_url: null,
      support_email: null,
      raw_snippets: [],
    })),
  ]);

  const social = mergeSocialLinks(brand.displayName, websiteSocial, {
    instagram_url: tavilySocial.instagram_url,
  });

  const meta = await fetchMetaAdsSignal({
    brandName: brand.displayName,
    website,
    instagramHandle: social.instagram_handle,
    facebookPageUrl: social.facebook_page_url,
  });

  return {
    company_name_normalized: brand.key,
    display_name: brand.displayName,
    domain,
    instagram_handle: social.instagram_handle,
    facebook_page_url: meta.facebook_page_url ?? social.facebook_page_url ?? null,
    meta_page_id: meta.meta_page_id ?? null,
    meta_ads_library_url: meta.meta_ads_library_url ?? null,
    meta_ads_latest_start: meta.meta_ads_latest_start ?? null,
    meta_ads_active_count: meta.meta_ads_active_count ?? null,
    meta_ads_status: meta.meta_ads_status ?? null,
    meta_ads_as_of: meta.meta_ads_as_of ?? null,
  };
}

export async function upsertBrandSocialSignals(
  supabaseAdmin: SupabaseClient,
  signals: BrandSocialSignals
): Promise<BrandEnrichmentRow> {
  const patch = {
    display_name: signals.display_name,
    domain: signals.domain,
    instagram_handle: signals.instagram_handle,
    facebook_page_url: signals.facebook_page_url,
    meta_page_id: signals.meta_page_id,
    meta_ads_library_url: signals.meta_ads_library_url,
    meta_ads_latest_start: signals.meta_ads_latest_start,
    meta_ads_active_count: signals.meta_ads_active_count,
    meta_ads_status: signals.meta_ads_status,
    meta_ads_as_of: signals.meta_ads_as_of,
  };

  const { data: existing } = await supabaseAdmin
    .from("market_intel_brand_enrichment")
    .select("company_name_normalized")
    .eq("company_name_normalized", signals.company_name_normalized)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from("market_intel_brand_enrichment")
      .update(patch)
      .eq("company_name_normalized", signals.company_name_normalized)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as BrandEnrichmentRow;
  }

  const { data, error } = await supabaseAdmin
    .from("market_intel_brand_enrichment")
    .insert({
      company_name_normalized: signals.company_name_normalized,
      ...patch,
      funding_events: [],
      news_articles: [],
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as BrandEnrichmentRow;
}

export async function enrichBrandSocial(
  supabaseAdmin: SupabaseClient,
  brand: AggregatedBrand
): Promise<BrandEnrichmentRow> {
  const signals = await resolveBrandSocialSignals(brand);
  return upsertBrandSocialSignals(supabaseAdmin, signals);
}

export function brandNeedsSocialRefresh(
  enrichment: BrandEnrichmentRow | undefined
): boolean {
  if (!enrichment) return true;
  if (
    !enrichment.instagram_handle &&
    !enrichment.meta_ads_library_url &&
    enrichment.meta_ads_status !== "not_found"
  ) {
    return true;
  }
  if (!enrichment.meta_ads_as_of) return true;
  const ageMs = Date.now() - new Date(enrichment.meta_ads_as_of).getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
}
