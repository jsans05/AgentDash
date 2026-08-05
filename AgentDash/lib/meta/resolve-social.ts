const USER_AGENT = "WassQuant-Firmographics/1.0";

export type ResolvedSocialLinks = {
  instagram_handle: string | null;
  instagram_url: string | null;
  facebook_page_url: string | null;
};

const SKIP_INSTAGRAM_PATHS = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "about",
  "developer",
  "legal",
]);

const SKIP_FACEBOOK_PATHS = new Set([
  "login",
  "help",
  "ads",
  "watch",
  "groups",
  "events",
  "share",
  "sharer",
  "dialog",
  "plugins",
  "tr",
  "privacy",
  "policies",
  "legal",
  "business",
  "l.php",
  "profile.php",
  "photo.php",
  "video.php",
  "story.php",
  "hashtag",
  "pages",
  "marketplace",
]);

const FACEBOOK_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.|m\.|mbasic\.)?(?:facebook\.com|fb\.com)\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?/gi;

const INSTAGRAM_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/gi;

function extractInstagramHandlesFromText(text: string): string[] {
  const handles = new Set<string>();
  const re = new RegExp(INSTAGRAM_URL_REGEX.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const handle = normalizeInstagramHandle(match[1] ?? match[0]);
    if (handle) handles.add(handle);
  }
  return [...handles];
}

export function scoreInstagramHandle(handle: string, brandName: string): number {
  const normalized = normalizeInstagramHandle(handle);
  if (!normalized) return 0;

  const brandLower = brandName.trim().toLowerCase();
  const brandSlug = brandLower.replace(/[^a-z0-9]/g, "");
  const handleNorm = normalized.replace(/[^a-z0-9]/g, "");

  if (normalized === brandLower || handleNorm === brandSlug) return 100;
  if (handleNorm.startsWith(brandSlug) && handleNorm.length > brandSlug.length) return 85;
  if (handleNorm.includes(brandSlug) && brandSlug.length >= 4) return 70;
  return 0;
}

export function pickBestInstagramHandle(
  candidates: string[],
  brandName: string
): string | null {
  const scored = candidates
    .map((handle) => ({
      handle: normalizeInstagramHandle(handle),
      score: scoreInstagramHandle(handle, brandName),
    }))
    .filter((item): item is { handle: string; score: number } => Boolean(item.handle && item.score > 0))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.handle ?? null;
}

export function pickBestSocialLinks(
  brandName: string,
  ...sources: Array<Partial<ResolvedSocialLinks> | null | undefined>
): ResolvedSocialLinks {
  const instagramCandidates: string[] = [];
  const facebookCandidates: string[] = [];

  for (const source of sources) {
    if (!source) continue;
    if (source.instagram_handle) instagramCandidates.push(source.instagram_handle);
    if (source.instagram_url) instagramCandidates.push(source.instagram_url);
    if (source.facebook_page_url) {
      const normalized = normalizeFacebookPageUrl(source.facebook_page_url);
      if (normalized) facebookCandidates.push(normalized);
    }
  }

  const instagram_handle = pickBestInstagramHandle(instagramCandidates, brandName);
  const facebook_page_url = pickBestFacebookPageUrl(facebookCandidates, brandName);

  return {
    instagram_handle,
    instagram_url: instagram_handle ? `https://www.instagram.com/${instagram_handle}/` : null,
    facebook_page_url,
  };
}

function normalizeInstagramHandle(raw: string): string | null {
  let value = raw.trim().replace(/^@/, "");
  if (!value) return null;

  try {
    if (value.includes("instagram.com")) {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`);
      const parts = url.pathname.split("/").filter(Boolean);
      const handle = parts[0]?.toLowerCase();
      if (!handle || SKIP_INSTAGRAM_PATHS.has(handle)) return null;
      value = handle;
    }
  } catch {
    // keep raw handle
  }

  value = value.split("?")[0]?.split("/")[0]?.toLowerCase() ?? "";
  if (!value || !/^[a-z0-9._]+$/.test(value)) return null;
  return value;
}

function facebookPathSlug(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]?.toLowerCase();
  if (!first || SKIP_FACEBOOK_PATHS.has(first)) return null;
  if (/^\d+$/.test(first)) return first;
  return first;
}

function normalizeFacebookPageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (!host.includes("facebook.com") && !host.includes("fb.com")) return null;

    const slug = facebookPathSlug(url.pathname);
    if (!slug) return null;

    if (/^\d+$/.test(slug)) {
      return `https://www.facebook.com/${slug}`;
    }
    return `https://www.facebook.com/${slug}`;
  } catch {
    return null;
  }
}

function brandSlugVariants(brandName: string): string[] {
  const trimmed = brandName.trim();
  if (!trimmed) return [];

  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(trimmed.toLowerCase());
  variants.add(trimmed.replace(/\s+/g, ""));

  const alphaNum = trimmed.replace(/[^a-zA-Z0-9]/g, "");
  if (alphaNum) {
    variants.add(alphaNum);
    variants.add(alphaNum.toLowerCase());
  }

  return [...variants].filter(Boolean);
}

function extractFacebookUrlsFromText(text: string): string[] {
  const urls = new Set<string>();
  const re = new RegExp(FACEBOOK_URL_REGEX.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const normalized = normalizeFacebookPageUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

export function scoreFacebookPageUrl(url: string, brandName: string): number {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    if (!slug || /^\d+$/.test(slug)) return 5;

    const brandLower = brandName.trim().toLowerCase();
    const brandSlug = brandLower.replace(/[^a-z0-9]/g, "");
    const slugNorm = slug.replace(/[^a-z0-9]/g, "");

    if (slug === brandLower || slugNorm === brandSlug) return 100;
    if (slugNorm.startsWith(brandSlug) && slugNorm.length > brandSlug.length) return 45;
    if (slugNorm.includes(brandSlug)) return 25;
    return 8;
  } catch {
    return 0;
  }
}

export function pickBestFacebookPageUrl(candidates: string[], brandName: string): string | null {
  const scored = candidates
    .map((url) => ({ url, score: scoreFacebookPageUrl(url, brandName) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.url ?? null;
}

async function searchFacebookPageViaTavily(brandName: string): Promise<string[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return [];

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: `${brandName} official facebook page`,
        search_depth: "basic",
        include_answer: false,
        max_results: 10,
      }),
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      results?: Array<{ url?: string; content?: string }>;
    };

    const urls = new Set<string>();
    for (const row of data.results ?? []) {
      if (row.url && /facebook\.com/i.test(row.url)) {
        const normalized = normalizeFacebookPageUrl(row.url);
        if (normalized) urls.add(normalized);
      }
      if (row.content) {
        for (const url of extractFacebookUrlsFromText(row.content)) {
          urls.add(url);
        }
      }
    }
    return [...urls];
  } catch {
    return [];
  }
}

async function fetchWebsiteHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      next: { revalidate: 0 },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractFromHtml(html: string, brandName?: string | null): ResolvedSocialLinks {
  const instagram = new Set<string>();
  const facebook = new Set<string>();

  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (/instagram\.com/i.test(href)) {
      const handle = normalizeInstagramHandle(href);
      if (handle) instagram.add(handle);
    }
    if (/facebook\.com|fb\.com/i.test(href)) {
      const fb = normalizeFacebookPageUrl(href);
      if (fb) facebook.add(fb);
    }
  }

  for (const handle of extractInstagramHandlesFromText(html)) {
    instagram.add(handle);
  }

  for (const fb of extractFacebookUrlsFromText(html)) {
    facebook.add(fb);
  }

  const brand = brandName?.trim() ?? "";
  const instagram_handle =
    pickBestInstagramHandle([...instagram], brand) ?? (brand ? null : [...instagram][0] ?? null);
  const facebook_page_url =
    pickBestFacebookPageUrl([...facebook], brand) ?? (brand ? null : [...facebook][0] ?? null);

  return {
    instagram_handle,
    instagram_url: instagram_handle ? `https://www.instagram.com/${instagram_handle}/` : null,
    facebook_page_url,
  };
}

export function collectFacebookPageCandidates(opts: {
  brandName: string;
  websiteHtml?: string | null;
  instagramHandle?: string | null;
  facebookPageUrl?: string | null;
  tavilyUrls?: string[];
}): string[] {
  const candidates = new Set<string>();

  if (opts.facebookPageUrl) {
    const normalized = normalizeFacebookPageUrl(opts.facebookPageUrl);
    if (normalized) candidates.add(normalized);
  }

  if (opts.websiteHtml) {
    for (const url of extractFacebookUrlsFromText(opts.websiteHtml)) {
      candidates.add(url);
    }
  }

  if (opts.instagramHandle) {
    const handle = normalizeInstagramHandle(opts.instagramHandle);
    if (handle) {
      candidates.add(`https://www.facebook.com/${handle}`);
    }
  }

  for (const slug of brandSlugVariants(opts.brandName)) {
    candidates.add(`https://www.facebook.com/${slug}`);
  }

  for (const url of opts.tavilyUrls ?? []) {
    candidates.add(url);
  }

  return [...candidates];
}

export async function discoverFacebookPageCandidates(opts: {
  brandName: string;
  website?: string | null;
  instagramHandle?: string | null;
  facebookPageUrl?: string | null;
}): Promise<{ candidates: string[]; bestUrl: string | null }> {
  let websiteHtml: string | null = null;
  if (opts.website?.trim()) {
    let baseUrl = opts.website.trim();
    if (!baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;
    websiteHtml = await fetchWebsiteHtml(baseUrl);
  }

  const tavilyUrls = await searchFacebookPageViaTavily(opts.brandName);

  const candidates = collectFacebookPageCandidates({
    brandName: opts.brandName,
    websiteHtml,
    instagramHandle: opts.instagramHandle,
    facebookPageUrl: opts.facebookPageUrl,
    tavilyUrls,
  });

  return {
    candidates,
    bestUrl: pickBestFacebookPageUrl(candidates, opts.brandName),
  };
}

export async function resolveSocialLinksFromWebsite(
  website: string | null | undefined,
  brandName?: string | null
): Promise<ResolvedSocialLinks> {
  const empty: ResolvedSocialLinks = {
    instagram_handle: null,
    instagram_url: null,
    facebook_page_url: null,
  };

  if (!website?.trim()) return empty;

  let baseUrl = website.trim();
  if (!baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;

  const html = await fetchWebsiteHtml(baseUrl);
  if (!html) return empty;

  return extractFromHtml(html, brandName);
}

export function mergeSocialLinks(
  brandName: string,
  ...sources: Array<Partial<ResolvedSocialLinks> | null | undefined>
): ResolvedSocialLinks {
  return pickBestSocialLinks(brandName, ...sources);
}

export { normalizeInstagramHandle, normalizeFacebookPageUrl, fetchWebsiteHtml };
