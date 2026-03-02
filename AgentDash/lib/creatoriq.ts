/**
 * CreatorIQ API client (server-side only)
 * Docs: https://apidocs.creatoriq.com/docs/ciq-api-documentation/o5yqwvpp1lbnb-overview
 *
 * Cycle environment: set CREATORIQ_ORG_NAME=Cycle and use the Cycle API key.
 */

/** Use https://apis.creatoriq.com (with 's') — api.creatoriq.com returns 404. */
const BASE_URL = process.env.CREATORIQ_BASE_URL || "https://apis.creatoriq.com";
const API_KEY = process.env.CREATORIQ_API_KEY;
/** Org/tenant name (e.g. Cycle). Try division name if 403: CREATORIQ_ORG_NAME=Wasserman */
const ORG_NAME = process.env.CREATORIQ_ORG_NAME || "";
/** Division from CreatorIQ "Select Division" (e.g. Wasserman). Sent as X-Division if set. */
const DIVISION = process.env.CREATORIQ_DIVISION || "";
/** Whether to append ?key=Id to publisher endpoints (for CreatorIQID vs publisherId). */
const USE_ID_KEY_PARAM = process.env.CREATORIQ_USE_ID_KEY !== "false";

if (!API_KEY) {
  throw new Error("CREATORIQ_API_KEY is required");
}

/**
 * Build CreatorIQ API URL with optional ?key=Id parameter.
 * @param path - API path template (e.g. "publisher/{id}" or "publisher/{id}/audience")
 * @param id - Publisher ID or CreatorIQID
 * @param useIdKey - Whether to append ?key=Id (default: true, set CREATORIQ_USE_ID_KEY=false to disable)
 */
export function buildCiqUrl(path: string, id: string, useIdKey: boolean = USE_ID_KEY_PARAM): string {
  const encodedId = encodeURIComponent(id.trim());
  const urlPath = path.replace("{id}", encodedId);
  const base = BASE_URL.startsWith("http") ? BASE_URL : `https://${BASE_URL}`;
  const basePath = base.endsWith("/crm/v1/api") ? base : `${base}/crm/v1/api`;
  const url = `${basePath}/${urlPath}`;
  if (useIdKey && !url.includes("?")) {
    return `${url}?key=Id`;
  }
  return url;
}

export type CreatorIQFetchResult = {
  snapshots: Array<{ type: string; data: unknown }>;
  errors: string[];
};

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "x-api-key": API_KEY!,
    "Authorization": `Bearer ${API_KEY!}`,
  };
  if (ORG_NAME) headers["X-Org-Name"] = ORG_NAME;
  if (DIVISION) headers["X-Division"] = DIVISION;
  return headers;
}

async function fetchEndpoint(
  publisherId: string,
  path: string,
  type: string,
  useIdKey: boolean = USE_ID_KEY_PARAM
): Promise<{ data: unknown } | { error: string }> {
  const url = buildCiqUrl(path, publisherId, useIdKey);
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  const bodySnippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  console.log(`[CreatorIQ] ${type} ${res.status} ${url}`);
  if (bodySnippet) {
    console.log(`[CreatorIQ] Response body (first 300 chars):`, bodySnippet);
  }

  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in (body as object)
      ? (body as { message: string }).message
      : typeof body === "object" && body && "error" in (body as object)
        ? (body as { error: string }).error
        : res.statusText || `HTTP ${res.status}`;
    console.error(`[CreatorIQ] ${type} ${res.status} ${url}`, msg, body);
    return {
      error: `${type}: ${res.status} ${msg}`.trim(),
    };
  }

  return { data: body };
}

/** Fetch a full URL with same auth (e.g. follow audience href). */
async function fetchUrl(url: string): Promise<{ data: unknown } | { error: string }> {
  try {
    // Some CIQ hrefs may already include ?key=Id; our caller might also add it.
    // Normalize to a single ?key=Id to avoid paths like ...?key=Id?key=Id
    let finalUrl = url.replace("?key=Id?key=Id", "?key=Id");
    console.log(`[CreatorIQ] fetchUrl Request URL: ${finalUrl}`);
    const res = await fetch(finalUrl, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    const bodySnippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
    console.log(`[CreatorIQ] fetchUrl Status: ${res.status}`);
    if (bodySnippet) {
      console.log(`[CreatorIQ] fetchUrl Response body (first 300 chars):`, bodySnippet);
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = typeof body === "object" && body && "message" in (body as object)
        ? (body as { message: string }).message
        : res.statusText || `HTTP ${res.status}`;
      console.error(`[CreatorIQ] fetchUrl ${res.status} ${url}`, msg);
      return { error: msg };
    }
    return { data: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CreatorIQ] fetchUrl Network error: ${message}`);
    return { error: message };
  }
}

/** True if audience body looks like a link-only response (no demographics). */
function isAudienceLinkOnly(data: unknown): data is { href: string } {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (typeof o.href !== "string") return false;
  if (o.demographics && typeof o.demographics === "object") return false;
  if (o.gender != null || o.age != null || o.age_breakdown != null) return false;
  return true;
}

/** Path variants to try for publisher (API route may vary by env). */
const PUBLISHER_PATH_VARIANTS = [
  "publisher/{id}",
  "publishers/{id}",
];

/**
 * Verify a Creator ID by fetching the creator from CreatorIQ.
 * ID from app URL: https://app.creatoriq.com/#creator/{id}/social
 * Tries several path variants until one returns 200.
 */
export async function verifyPublisherId(
  publisherId: string
): Promise<{ ok: true; name: string; data: unknown } | { ok: false; error: string }> {
  const trimId = publisherId.trim();
  if (!trimId) return { ok: false, error: "Creator ID is empty" };
  let lastError = "";
  for (const path of PUBLISHER_PATH_VARIANTS) {
    const result = await fetchEndpoint(trimId, path, "creator");
    if ("error" in result) {
      lastError = result.error;
      continue;
    }
    const data = result.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object") continue;
    const name =
      [data.name, data.displayName, data.display_name, data.fullName, data.full_name]
        .filter(Boolean)
        .map(String)[0] ||
      [data.firstName || data.first_name, data.lastName || data.last_name].filter(Boolean).length
        ? [data.firstName ?? data.first_name, data.lastName ?? data.last_name].map(String).join(" ").trim()
        : "";
    return { ok: true, name: name || "Creator found (no name in response)", data };
  }
  return { ok: false, error: lastError || "All publisher paths returned 404" };
}

/**
 * Fetch creator, audience, and social data. ID = creator ID from app.creatoriq.com/#creator/{id}/...
 * Tries multiple path variants for each endpoint.
 */
export async function fetchCreatorIQData(publisherId: string): Promise<CreatorIQFetchResult> {
  const snapshots: Array<{ type: string; data: unknown }> = [];
  const errors: string[] = [];
  const trimId = publisherId.trim();
  if (!trimId) return { snapshots, errors: ["Creator ID is empty"] };

  // Publisher: try path variants
  let publisherError = "";
  for (const path of PUBLISHER_PATH_VARIANTS) {
    const result = await fetchEndpoint(trimId, path, "publisher");
    if ("error" in result) {
      publisherError = result.error;
      continue;
    }
    if (result.data != null) {
      snapshots.push({ type: "publisher", data: result.data });
      break;
    }
  }
  if (!snapshots.some((s) => s.type === "publisher")) errors.push(publisherError || "publisher: not found");

  // Audience & social: try with same path prefix that worked, or common variants
  const basePaths = ["publisher/{id}", "publishers/{id}"];
  for (const base of basePaths) {
    const aud = await fetchEndpoint(trimId, `${base}/audience`, "audience");
    if (!("error" in aud) && aud.data != null) {
      if (!snapshots.some((s) => s.type === "audience")) snapshots.push({ type: "audience", data: aud.data });
      break;
    }
  }
  for (const base of basePaths) {
    const soc = await fetchEndpoint(trimId, `${base}/social-accounts`, "social");
    if (!("error" in soc) && soc.data != null) {
      if (!snapshots.some((s) => s.type === "social")) snapshots.push({ type: "social", data: soc.data });
      break;
    }
  }

  if (!snapshots.some((s) => s.type === "audience")) errors.push("audience: not found");
  if (!snapshots.some((s) => s.type === "social")) errors.push("social: not found");
  return { snapshots, errors: errors.filter(Boolean) };
}

/** Working endpoints only (confirmed): accounts + audience */
const WORKING_ACCOUNTS_PATH = "publishers/{id}/accounts";
const WORKING_AUDIENCE_PATH = "publisher/{id}/audience";

/** Engagement rate async job endpoint (may vary by env; adjust path if needed). */
const ENGAGEMENT_RATE_JOB_PATH = "publishers/{id}/engagement-rate";
/** Social accountInfo endpoint (link source). */
const ACCOUNT_INFO_PATH = "social/accountInfo";

const MAX_RETRIES = 2;
const BACKOFF_MS = 1000;

export type CreatorIQWorkingSnapshot = { type: "accounts" | "audience"; data: unknown };

export type CreatorIQWorkingResult = {
  snapshots: CreatorIQWorkingSnapshot[];
  errors: string[];
};

/** Lightweight number coercion for metrics normalisation. */
function numMetric(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

export type CreatorIQEngagementMetrics = {
  engagement_rate?: number;
  impressions?: number;
  engaged_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  [key: string]: unknown;
};

/**
 * Normalise CreatorIQ engagement report JSON into a compact metrics object.
 * Keeps common fields under stable keys; leaves full report in `raw`.
 */
export function normalizeEngagementReport(report: Record<string, unknown>): CreatorIQEngagementMetrics {
  const m: CreatorIQEngagementMetrics = {};
  const r = report as Record<string, unknown>;
  const metrics = (r.metrics ?? r.data ?? r.summary) as Record<string, unknown> | undefined;
  const src = metrics && typeof metrics === "object" ? metrics : r;

  const er =
    numMetric(src.engagement_rate) ??
    numMetric(src.engagementRate) ??
    numMetric((src as any).EngagementRate);
  if (er !== undefined) m.engagement_rate = er;

  const impressions =
    numMetric(src.impressions) ??
    numMetric(src.total_impressions) ??
    numMetric(src.TotalImpressions);
  if (impressions !== undefined) m.impressions = impressions;

  const engagedViews =
    numMetric(src.engaged_views) ??
    numMetric(src.engagedViews) ??
    numMetric(src.EngagedViews);
  if (engagedViews !== undefined) m.engaged_views = engagedViews;

  const likes =
    numMetric(src.likes) ??
    numMetric(src.total_likes) ??
    numMetric(src.Likes);
  if (likes !== undefined) m.likes = likes;

  const comments =
    numMetric(src.comments) ??
    numMetric(src.total_comments) ??
    numMetric(src.Comments);
  if (comments !== undefined) m.comments = comments;

  const shares =
    numMetric(src.shares) ??
    numMetric(src.total_shares) ??
    numMetric(src.Shares);
  if (shares !== undefined) m.shares = shares;

  const saves =
    numMetric(src.saves) ??
    numMetric(src.total_saves) ??
    numMetric(src.Saves);
  if (saves !== undefined) m.saves = saves;

  const clicks =
    numMetric(src.clicks) ??
    numMetric(src.total_clicks) ??
    numMetric(src.Clicks);
  if (clicks !== undefined) m.clicks = clicks;

  return m;
}

/** Fetch JSON from arbitrary URL without CIQ auth headers (used for S3 report URLs). */
async function fetchJsonNoAuth(url: string): Promise<{ data: unknown } | { error: string }> {
  try {
    console.log("[CreatorIQ] fetchJsonNoAuth Request URL:", url.split("?")[0]);
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      console.error("[CreatorIQ] fetchJsonNoAuth error", res.status, res.statusText, text.slice(0, 300));
      return { error: res.statusText || `HTTP ${res.status}` };
    }
    return { data: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CreatorIQ] fetchJsonNoAuth network error:", message);
    return { error: message };
  }
}

type EngagementTaskResponse = {
  TaskId?: string;
  taskId?: string;
  id?: string;
  Result?: {
    Headers?: {
      Location?: string;
      location?: string;
    };
  };
  Location?: string;
  location?: string;
  [key: string]: unknown;
};

/**
 * Poll a CIQ async task until Result.Headers.Location is present or timeout.
 * Max wait ~60s with simple backoff.
 */
async function pollEngagementTaskForLocation(
  publisherId: string,
  taskId: string,
  type: string
): Promise<string | null> {
  const maxMs = 60_000;
  const intervalMs = 5_000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = await fetchEndpoint(publisherId.trim(), `tasks/${taskId}`, type, false);
    if ("error" in result) {
      console.error("[CreatorIQ] engagement-task poll error:", result.error);
      return null;
    }
    const data = result.data as EngagementTaskResponse;
    const loc =
      data.Result?.Headers?.Location ??
      data.Result?.Headers?.location ??
      data.Location ??
      data.location;
    if (loc && typeof loc === "string") {
      console.log("[CreatorIQ] engagement-task Location found:", loc.split("?")[0]);
      return loc;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error("[CreatorIQ] engagement-task poll timeout after 60s");
  return null;
}

export type CreatorIQEngagementReportResult =
  | {
      ok: true;
      report: Record<string, unknown>;
      metrics: CreatorIQEngagementMetrics;
      startDate: string | null;
      endDate: string | null;
    }
  | { ok: false; error: string };

/**
 * Fetch CreatorIQ engagement rate report for a publisher via async job pattern.
 * 1) POST/GET job endpoint (ENGAGEMENT_RATE_JOB_PATH) to create Task.
 * 2) Poll task status until Result.Headers.Location (S3 URL) is present or timeout.
 * 3) Fetch S3 URL and return parsed report JSON + normalised metrics.
 */
export async function fetchCiqEngagementRate(
  publisherId: string
): Promise<CreatorIQEngagementReportResult> {
  const trimId = publisherId.trim();
  if (!trimId) return { ok: false, error: "Creator ID is empty" };

  // 1) Kick off engagement rate job
  const jobResult = await fetchEndpoint(trimId, ENGAGEMENT_RATE_JOB_PATH, "engagement-rate");
  if ("error" in jobResult) {
    return { ok: false, error: jobResult.error };
  }
  const jobData = jobResult.data as EngagementTaskResponse;
  const taskId =
    jobData.TaskId ?? jobData.taskId ?? jobData.id ?? (jobData as any).TaskID ?? null;
  let location =
    jobData.Result?.Headers?.Location ??
    jobData.Result?.Headers?.location ??
    jobData.Location ??
    jobData.location ??
    null;

  console.log("[CreatorIQ] engagement-rate job created", {
    taskId,
    hasLocation: Boolean(location),
  });

  if (!taskId && !location) {
    return { ok: false, error: "engagement-rate: TaskId and Location missing in response" };
  }

  // 2) Poll task status if needed
  if (!location && taskId) {
    location = await pollEngagementTaskForLocation(trimId, String(taskId), "engagement-task");
  }
  if (!location) {
    return { ok: false, error: "engagement-rate: Location not available after polling" };
  }

  const redactedUrl = location.split("?")[0];
  console.log("[CreatorIQ] engagement-rate S3 URL:", redactedUrl);

  // 3) Fetch final JSON report from S3 URL
  const s3 = await fetchJsonNoAuth(location);
  if ("error" in s3) {
    return { ok: false, error: `engagement-rate: failed to fetch report – ${s3.error}` };
  }
  const report = (s3.data ?? {}) as Record<string, unknown>;
  const keys = Object.keys(report);
  console.log("[CreatorIQ] engagement-rate report keys:", keys.slice(0, 20));

  const metrics = normalizeEngagementReport(report);

  // Try to extract date range if present
  const period = (report.period ?? report.Period ?? report.date_range) as
    | { start?: string; end?: string; from?: string; to?: string }
    | undefined;
  const startDate =
    (period?.start as string | undefined) ??
    (period?.from as string | undefined) ??
    (report.start_date as string | undefined) ??
    null;
  const endDate =
    (period?.end as string | undefined) ??
    (period?.to as string | undefined) ??
    (report.end_date as string | undefined) ??
    null;

  return {
    ok: true,
    report,
    metrics,
    startDate,
    endDate,
  };
}

// ---------------------------------------------------------------------------
// accountInfo (social account metadata) by link
// ---------------------------------------------------------------------------

export type CreatorIQAccountInfoMetrics = {
  type?: string;
  name?: string;
  url?: string;
  profileImageUrl?: string;
  posts?: number;
  followers?: number;
  likes?: number;
  bio?: string;
  avgLikes?: number;
  avgLikes10?: number;
  avgComments?: number;
  avgComments10?: number;
  verified?: boolean;
  [key: string]: unknown;
};

function inferNetworkFromType(type: string | undefined): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes("instagram")) return "instagram";
  if (t.includes("tiktok")) return "tiktok";
  if (t.includes("youtube")) return "youtube";
  if (t.includes("facebook")) return "facebook";
  if (t.includes("twitter") || t.includes("xaccount")) return "twitter";
  return null;
}

export function normalizeAccountInfo(
  response: Record<string, unknown>
): { metrics: CreatorIQAccountInfoMetrics; network: string | null; handle: string | null; url: string | null; ciqId: string | null } {
  const r = response as Record<string, unknown>;
  const type = typeof r.type === "string" ? (r.type as string) : undefined;
  const payloadKey = type && typeof type === "string" ? type : undefined;
  const payload =
    (payloadKey && r[payloadKey] && typeof r[payloadKey] === "object"
      ? (r[payloadKey] as Record<string, unknown>)
      : null) ?? null;

  const m: CreatorIQAccountInfoMetrics = {};
  m.type = type;

  const p = payload ?? r;

  const name = (p.name ?? p.username ?? p.handle ?? p.screen_name) as string | undefined;
  const url = (p.url ?? p.profileUrl ?? p.profile_url) as string | undefined;
  const profileImageUrl = (p.profileImageUrl ?? p.profile_image_url ?? p.profile_image_url_https) as
    | string
    | undefined;
  const posts = numMetric(p.posts ?? p.postCount ?? p.posts_count);
  const followers =
    numMetric(p.followers ?? p.followersCount ?? p.followers_count ?? p.follower_count) ??
    numMetric((p as any).Followers);
  const likes =
    numMetric(p.likes ?? p.likesCount ?? p.totalLikes ?? p.total_likes) ??
    numMetric((p as any).Likes);
  const bio = (p.bio ?? p.description ?? p.about) as string | undefined;
  const avgLikes = numMetric(p.avgLikes ?? p.average_likes ?? p.avg_likes);
  const avgLikes10 = numMetric(p.avgLikes10 ?? p.average_likes_10 ?? p.avg_likes_10);
  const avgComments = numMetric(p.avgComments ?? p.average_comments ?? p.avg_comments);
  const avgComments10 = numMetric(p.avgComments10 ?? p.average_comments_10 ?? p.avg_comments_10);
  const verified =
    (p.verified as boolean | undefined) ??
    (typeof p.isVerified === "boolean" ? (p.isVerified as boolean) : undefined);

  if (name) m.name = name;
  if (url) m.url = url;
  if (profileImageUrl) m.profileImageUrl = profileImageUrl;
  if (posts !== undefined) m.posts = posts;
  if (followers !== undefined) m.followers = followers;
  if (likes !== undefined) m.likes = likes;
  if (bio) m.bio = bio;
  if (avgLikes !== undefined) m.avgLikes = avgLikes;
  if (avgLikes10 !== undefined) m.avgLikes10 = avgLikes10;
  if (avgComments !== undefined) m.avgComments = avgComments;
  if (avgComments10 !== undefined) m.avgComments10 = avgComments10;
  if (typeof verified === "boolean") m.verified = verified;

  const network = inferNetworkFromType(type);
  const ciqId =
    (p.id as string | number | undefined) != null
      ? String(p.id)
      : (p.AccountId as string | number | undefined) != null
      ? String(p.AccountId)
      : null;

  return {
    metrics: m,
    network,
    handle: name ?? null,
    url: url ?? null,
    ciqId,
  };
}

/**
 * Fetch CreatorIQ social accountInfo by link.
 * Uses `/crm/v1/api/social/accountInfo?source=link&link=<encoded>` with CIQ auth headers.
 */
export async function fetchCiqAccountInfoByLink(
  linkUrl: string
): Promise<{ ok: true; response: Record<string, unknown> } | { ok: false; error: string }> {
  if (!linkUrl || !linkUrl.trim()) {
    return { ok: false, error: "linkUrl required" };
  }
  const base = BASE_URL.startsWith("http") ? BASE_URL : `https://${BASE_URL}`;
  const basePath = base.endsWith("/crm/v1/api") ? base : `${base}/crm/v1/api`;
  const url = `${basePath}/${ACCOUNT_INFO_PATH}?source=link&link=${encodeURIComponent(linkUrl.trim())}`;

  try {
    console.log("[CreatorIQ] accountInfo Request URL:", url.split("?")[0]);
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store",
    });
    const text = await res.text();
    const bodySnippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
    console.log("[CreatorIQ] accountInfo Status:", res.status);
    if (bodySnippet) {
      console.log("[CreatorIQ] accountInfo Response body (first 300 chars):", bodySnippet);
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg =
        typeof body === "object" && body && "message" in (body as object)
          ? (body as { message: string }).message
          : res.statusText || `HTTP ${res.status}`;
      console.error("[CreatorIQ] accountInfo error", res.status, msg);
      return { ok: false, error: msg };
    }
    if (!body || typeof body !== "object") {
      return { ok: false, error: "accountInfo: unexpected response shape" };
    }
    const keys = Object.keys(body as Record<string, unknown>);
    console.log("[CreatorIQ] accountInfo keys:", keys.slice(0, 20));
    return { ok: true, response: body as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[CreatorIQ] accountInfo network error:", message);
    return { ok: false, error: message };
  }
}

async function fetchWithRetry(
  publisherId: string,
  path: string,
  type: "accounts" | "audience",
  useIdKey: boolean = USE_ID_KEY_PARAM
): Promise<{ data: unknown } | { error: string }> {
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
    const result = await fetchEndpoint(publisherId.trim(), path, type, useIdKey);
    if (!("error" in result)) return result;
    lastError = result.error;
    console.error(`[CreatorIQ] ${type} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed:`, result.error);
  }
  return { error: lastError };
}

/**
 * Fetch only the two working CreatorIQ endpoints: accounts and audience.
 * Uses retries (max 2) with backoff. Safe for monthly + on-demand refresh.
 */
export async function fetchCreatorIQSnapshotsWorkingEndpoints(
  publisherId: string
): Promise<CreatorIQWorkingResult> {
  const snapshots: CreatorIQWorkingSnapshot[] = [];
  const errors: string[] = [];
  const trimId = publisherId.trim();
  if (!trimId) {
    return { snapshots, errors: ["Creator ID is empty"] };
  }

  const accountsResult = await fetchWithRetry(trimId, WORKING_ACCOUNTS_PATH, "accounts");
  if ("error" in accountsResult) {
    errors.push(accountsResult.error);
  } else if (accountsResult.data != null) {
    snapshots.push({ type: "accounts", data: accountsResult.data });
  }

  const audienceResult = await fetchWithRetry(trimId, WORKING_AUDIENCE_PATH, "audience");
  if ("error" in audienceResult) {
    errors.push(audienceResult.error);
  } else if (audienceResult.data != null) {
    let audienceData = audienceResult.data;
    if (isAudienceLinkOnly(audienceData)) {
      const resolved = await fetchUrl((audienceData as { href: string }).href);
      if (!("error" in resolved) && resolved.data != null) {
        audienceData = resolved.data;
      }
    }
    snapshots.push({ type: "audience", data: audienceData });
  }

  return { snapshots, errors };
}
