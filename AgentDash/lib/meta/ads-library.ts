import { discoverFacebookPageCandidates, fetchWebsiteHtml, pickBestFacebookPageUrl, scoreFacebookPageUrl } from "@/lib/meta/resolve-social";
export type MetaAdsSignal = {
  meta_page_id: string | null;
  meta_ads_library_url: string | null;
  meta_ads_latest_start: string | null;
  meta_ads_active_count: number | null;
  meta_ads_status: "active" | "library_link_only" | "page_search" | "keyword_search" | "not_found" | null;
  meta_ads_as_of: string | null;
  facebook_page_url?: string | null;
};
export function isValidMetaPageId(pageId: string | null | undefined): boolean {
  const id = pageId?.trim();
  if (!id || !/^\d+$/.test(id)) return false;
  if (id === "0") return false;
  return id.length >= 8;
}
export function normalizeMetaPageId(pageId: string | null | undefined): string | null {
  return isValidMetaPageId(pageId) ? pageId!.trim() : null;
}
function metaToken(): string | null {
  return process.env.META_ACCESS_TOKEN?.trim() || null;
}
export function buildMetaAdsLibraryUrl(pageId: string, country = "US"): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    is_targeted_country: "false",
    view_all_page_id: pageId,
    search_type: "page",
    media_type: "all"
  });
  params.set("sort_data[direction]", "desc");
  params.set("sort_data[mode]", "total_impressions");
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}
export function buildMetaAdsKeywordLibraryUrl(brandName: string, country = "US"): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    is_targeted_country: "false",
    q: brandName,
    search_type: "keyword",
    media_type: "all"
  });
  params.set("sort_data[direction]", "desc");
  params.set("sort_data[mode]", "total_impressions");
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}
export function buildMetaAdsPageSearchLibraryUrl(brandName: string, country = "US"): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    is_targeted_country: "false",
    q: brandName,
    search_type: "page",
    media_type: "all"
  });
  params.set("sort_data[direction]", "desc");
  params.set("sort_data[mode]", "total_impressions");
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}
async function graphGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const token = metaToken();
  if (!token) return null;
  const url = new URL(`https://graph.facebook.com/v21.0/${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url.toString(), {
      next: {
        revalidate: 0
      }
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
export function pageUsernameFromUrl(facebookPageUrl: string): string | null {
  try {
    const url = new URL(facebookPageUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0];
    if (/^\d+$/.test(first)) return first;
    return first;
  } catch {
    return null;
  }
}
export function extractPageIdFromFacebookHtml(html: string): string | null {
  const patterns = [/"pageID"\s*:\s*"(\d+)"/, /"page_id"\s*:\s*"(\d+)"/, /"pageId"\s*:\s*"(\d+)"/, /"entity_id"\s*:\s*"(\d+)"/, /"profile_id"\s*:\s*"(\d+)"/, /fb:\/\/page\/(\d+)/, /content="fb:\/\/page\/(\d+)"/];
  for (const pattern of patterns) {
    for (const match of html.matchAll(new RegExp(pattern.source, "g"))) {
      const pageId = normalizeMetaPageId(match[1]);
      if (pageId) return pageId;
    }
  }
  return null;
}
export function scorePageNameMatch(pageName: string, brandName: string): number {
  const page = pageName.trim().toLowerCase();
  const brand = brandName.trim().toLowerCase();
  if (!page || !brand) return 0;
  if (page === brand) return 100;
  const pageNorm = page.replace(/[^a-z0-9]/g, "");
  const brandNorm = brand.replace(/[^a-z0-9]/g, "");
  if (pageNorm === brandNorm) return 95;
  if (page.startsWith(`${brand} `) || page.endsWith(` ${brand}`)) return 80;
  if (page.includes(brand)) return 40;
  if (pageNorm.startsWith(brandNorm) && pageNorm.length > brandNorm.length) return 35;
  return 0;
}
async function resolveFacebookPageIdViaGraph(facebookPageUrl: string): Promise<string | null> {
  const username = pageUsernameFromUrl(facebookPageUrl);
  if (!username) return null;
  if (/^\d+$/.test(username)) return normalizeMetaPageId(username);
  const data = await graphGet<{
    id?: string;
  }>(username, {
    fields: "id"
  });
  return normalizeMetaPageId(data?.id);
}
async function scrapePageIdFromFacebookPage(facebookPageUrl: string): Promise<string | null> {
  const username = pageUsernameFromUrl(facebookPageUrl);
  if (!username) return null;
  if (/^\d+$/.test(username)) return normalizeMetaPageId(username);
  const urls = [facebookPageUrl, `https://www.facebook.com/${username}`, `https://mbasic.facebook.com/${username}`];
  for (const url of urls) {
    const html = await fetchWebsiteHtml(url);
    if (!html) continue;
    const pageId = normalizeMetaPageId(extractPageIdFromFacebookHtml(html));
    if (pageId) return pageId;
  }
  return null;
}
type AdsArchiveRow = {
  ad_delivery_start_time?: string;
  page_id?: string;
  page_name?: string;
};
type AdsArchiveResponse = {
  data?: AdsArchiveRow[];
};
async function resolvePageIdViaAdLibrarySearch(brandName: string): Promise<{
  pageId: string;
  pageName: string;
} | null> {
  const token = metaToken();
  if (!token) return null;
  const data = await graphGet<AdsArchiveResponse>("ads_archive", {
    search_terms: brandName,
    ad_reached_countries: JSON.stringify(["US"]),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: "page_id,page_name",
    limit: "100"
  });
  if (!data?.data?.length) return null;
  const grouped = new Map<string, {
    count: number;
    pageName: string;
  }>();
  for (const row of data.data) {
    const pageId = row.page_id?.trim();
    if (!pageId) continue;
    const existing = grouped.get(pageId);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(pageId, {
        count: 1,
        pageName: row.page_name ?? ""
      });
    }
  }
  let best: {
    pageId: string;
    pageName: string;
    score: number;
  } | null = null;
  for (const [pageId, info] of grouped) {
    const nameScore = scorePageNameMatch(info.pageName, brandName);
    if (nameScore === 0) continue;
    const score = nameScore * 1000 + info.count;
    if (!best || score > best.score) {
      best = {
        pageId,
        pageName: info.pageName,
        score
      };
    }
  }
  if (!best) return null;
  const pageId = normalizeMetaPageId(best.pageId);
  if (!pageId) return null;
  return {
    pageId,
    pageName: best.pageName
  };
}
export async function resolveFacebookPageId(facebookPageUrl: string | null | undefined, brandName?: string | null): Promise<string | null> {
  if (!facebookPageUrl?.trim()) {
    if (brandName?.trim()) {
      const fromSearch = await resolvePageIdViaAdLibrarySearch(brandName);
      return fromSearch?.pageId ?? null;
    }
    return null;
  }
  const graphId = await resolveFacebookPageIdViaGraph(facebookPageUrl);
  if (graphId) return graphId;
  const scrapedId = await scrapePageIdFromFacebookPage(facebookPageUrl);
  if (scrapedId) return scrapedId;
  if (brandName?.trim()) {
    const fromSearch = await resolvePageIdViaAdLibrarySearch(brandName);
    return fromSearch?.pageId ?? null;
  }
  return null;
}
async function searchActiveAds(pageId: string, countries: string[]): Promise<AdsArchiveRow[]> {
  const token = metaToken();
  if (!token) return [];
  const allRows: AdsArchiveRow[] = [];
  for (const country of countries) {
    const data = await graphGet<AdsArchiveResponse>("ads_archive", {
      search_page_ids: pageId,
      ad_reached_countries: JSON.stringify([country]),
      ad_active_status: "ACTIVE",
      ad_type: "ALL",
      fields: "ad_delivery_start_time,page_id,page_name,publisher_platforms",
      limit: "100"
    });
    if (data?.data?.length) {
      allRows.push(...data.data);
    }
  }
  return allRows;
}
export async function fetchMetaAdsSignal(opts: {
  brandName: string;
  website?: string | null;
  instagramHandle?: string | null;
  facebookPageUrl?: string | null;
  existingPageId?: string | null;
}): Promise<MetaAdsSignal> {
  const empty: MetaAdsSignal = {
    meta_page_id: null,
    meta_ads_library_url: null,
    meta_ads_latest_start: null,
    meta_ads_active_count: null,
    meta_ads_status: null,
    meta_ads_as_of: null,
    facebook_page_url: opts.facebookPageUrl ?? null
  };
  let pageId = normalizeMetaPageId(opts.existingPageId);
  let facebookPageUrl = opts.facebookPageUrl?.trim() || null;
  if (!pageId) {
    const discovery = await discoverFacebookPageCandidates({
      brandName: opts.brandName,
      website: opts.website,
      instagramHandle: opts.instagramHandle,
      facebookPageUrl: opts.facebookPageUrl
    });
    facebookPageUrl = pickBestFacebookPageUrl([...(facebookPageUrl ? [facebookPageUrl] : []), ...discovery.candidates], opts.brandName) ?? discovery.bestUrl ?? facebookPageUrl;
    pageId = normalizeMetaPageId(await resolveFacebookPageId(facebookPageUrl, opts.brandName));
    if (!pageId) {
      const fromSearch = await resolvePageIdViaAdLibrarySearch(opts.brandName);
      pageId = normalizeMetaPageId(fromSearch?.pageId);
    }
  }
  if (!pageId) {
    return {
      ...empty,
      facebook_page_url: facebookPageUrl,
      meta_ads_library_url: buildMetaAdsPageSearchLibraryUrl(opts.brandName),
      meta_ads_status: "page_search",
      meta_ads_as_of: new Date().toISOString()
    };
  }
  const libraryUrl = buildMetaAdsLibraryUrl(pageId);
  const rows = await searchActiveAds(pageId, ["US", "GB"]);
  if (rows.length === 0) {
    return {
      meta_page_id: pageId,
      facebook_page_url: facebookPageUrl,
      meta_ads_library_url: libraryUrl,
      meta_ads_latest_start: null,
      meta_ads_active_count: null,
      meta_ads_status: "library_link_only",
      meta_ads_as_of: new Date().toISOString()
    };
  }
  const starts = rows.map(r => r.ad_delivery_start_time).filter((d): d is string => Boolean(d)).sort();
  return {
    meta_page_id: pageId,
    facebook_page_url: facebookPageUrl,
    meta_ads_library_url: libraryUrl,
    meta_ads_latest_start: starts.length > 0 ? starts[starts.length - 1] : null,
    meta_ads_active_count: rows.length,
    meta_ads_status: "active",
    meta_ads_as_of: new Date().toISOString()
  };
}