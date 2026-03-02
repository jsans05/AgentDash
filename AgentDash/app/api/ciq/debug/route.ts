import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSafeHeaders } from "@/lib/safeHeaders";
import { truncate } from "@/lib/truncate";
import {
  buildCiqUrl,
  fetchCiqEngagementRate,
  fetchCiqAccountInfoByLink,
  normalizeAccountInfo,
} from "@/lib/creatoriq";

const ORIGIN = "https://apis.creatoriq.com";
const MAX_BODY_LEN = 10_000;

const ENDPOINT_URLS: Record<string, (id: string) => string> = {
  publisher: (id) => buildCiqUrl("publisher/{id}", id),
  audience: (id) => buildCiqUrl("publisher/{id}/audience", id),
  publisher_alt_v1: (id) => buildCiqUrl("v1/publisher/{id}", id),
  publisher_alt_v2: (id) => buildCiqUrl("publisher/{id}/publisher", id),
  accounts_bulk: (id) => buildCiqUrl("publishers/{id}/accounts", id),
  social_accounts_bulk: (id) => buildCiqUrl("publishers/{id}/accounts", id),
  publisher_accounts_single: (id) => buildCiqUrl("publisher/{id}/accounts", id),
  posts_recent: (id) => {
    const base = buildCiqUrl("publisher/{id}/posts", id);
    return base.includes("?") ? `${base}&limit=5` : `${base}?limit=5`;
  },
  publisher_social_summary: (id) => buildCiqUrl("publisher/{id}/social", id),
  publisher_root: (id) => buildCiqUrl("publisher/{id}/", id),
};

type EndpointKey =
  | keyof typeof ENDPOINT_URLS
  | "audience_href_probe"
  | "publisher_audience_platform"
  | "engagement_rate"
  | "account_info_link";

function buildPath(endpoint: string, publisherId: string, _extra?: { network?: string }): string | null {
  const fn = ENDPOINT_URLS[endpoint];
  return fn ? fn(publisherId) : null;
}

/** Extract first string href from JSON (root or common nested keys). */
function extractHref(obj: unknown): string | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.href === "string") return o.href;
  if (o.data && typeof (o.data as Record<string, unknown>).href === "string") return (o.data as Record<string, unknown>).href as string;
  if (o.audience && typeof (o.audience as Record<string, unknown>).href === "string") return (o.audience as Record<string, unknown>).href as string;
  if (Array.isArray(o) && o[0] && typeof (o[0] as Record<string, unknown>).href === "string") return (o[0] as Record<string, unknown>).href as string;
  return null;
}

function resolveHref(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base = ORIGIN.endsWith("/") ? ORIGIN : ORIGIN + "/";
  return href.startsWith("/") ? ORIGIN + href : base + href;
}

async function fetchOne(
  path: string,
  apiKey: string
): Promise<{ ok: boolean; request: { url: string; method: string }; response: { status: number; headers: Record<string, string>; bodyTextTruncated: string; isJson: boolean; bodyJson?: unknown } }> {
  const method = "GET";
  console.log(`[CreatorIQ Debug] Request URL: ${path}`);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "Accept": "application/json", "x-api-key": apiKey },
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    console.error(`[CreatorIQ Debug] Network error: ${message}`);
    return {
      ok: false,
      request: { url: path, method },
      response: {
        status: 0,
        headers: {},
        bodyTextTruncated: `Network error: ${message}`,
        isJson: false,
      },
    };
  }
  const bodyText = await res.text();
  const bodySnippet = bodyText.length > 300 ? bodyText.slice(0, 300) + "..." : bodyText;
  console.log(`[CreatorIQ Debug] Status: ${res.status}`);
  if (bodySnippet) {
    console.log(`[CreatorIQ Debug] Response body (first 300 chars):`, bodySnippet);
  }
  const bodyTextTruncated = truncate(bodyText, MAX_BODY_LEN);
  let bodyJson: unknown = undefined;
  let isJson = false;
  try {
    if (bodyText) {
      bodyJson = JSON.parse(bodyText);
      isJson = true;
      // Full, untruncated JSON for deep debugging
      console.log("Full response:", JSON.stringify(bodyJson, null, 2));
    }
  } catch {
    // leave bodyJson undefined
  }
  return {
    ok: res.ok,
    request: { url: path, method },
    response: {
      status: res.status,
      headers: getSafeHeaders(res.headers),
      bodyTextTruncated,
      isJson,
      ...(bodyJson !== undefined && { bodyJson }),
    },
  };
}

export async function POST(req: Request) {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const apiKey = process.env.CREATORIQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CREATORIQ_API_KEY is not configured" },
      { status: 503 }
    );
  }

  let body: { publisherId?: string; endpoint?: string; network?: string; link?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const endpoint = (body.endpoint ?? "publisher") as EndpointKey;

  const publisherId = typeof body.publisherId === "string" ? body.publisherId.trim() : "";
  if (
    endpoint !== "engagement_rate" &&
    endpoint !== "account_info_link" &&
    (!publisherId || !/^\d+$/.test(publisherId))
  ) {
    return NextResponse.json(
      { error: "publisherId must be a non-empty numeric string" },
      { status: 400 }
    );
  }

  if (endpoint === "publisher_audience_platform") {
    const rawNetwork = typeof body.network === "string" ? body.network.trim().toLowerCase() : "";
    const allowed = ["instagram", "tiktok", "youtube", "facebook"];
    const network = allowed.includes(rawNetwork) ? rawNetwork : "instagram";
    const base = buildCiqUrl("publisher/{id}/audience", publisherId);
    const path = base.includes("?") ? `${base}&network=${encodeURIComponent(network)}` : `${base}?network=${encodeURIComponent(network)}`;
    const result = await fetchOne(path, apiKey);
    return NextResponse.json({
      ...result,
      endpoint: `publisher_audience_platform?network=${network}`,
    });
  }

  if (endpoint === "audience_href_probe") {
    const audiencePath = ENDPOINT_URLS.audience(publisherId);
    const first = await fetchOne(audiencePath, apiKey);
    const href = first.response.bodyJson != null ? extractHref(first.response.bodyJson) : null;
    if (!href) {
      return NextResponse.json({
        multi: true,
        results: [
          { endpoint: "audience_href_probe (audience)", ...first },
          {
            endpoint: "audience_href_probe (href)",
            ok: false,
            request: { url: "(no href in audience response)", method: "GET" },
            response: {
              status: 0,
              headers: {},
              bodyTextTruncated: "No href found in audience JSON.",
              isJson: false,
            },
          },
        ],
      });
    }
    const hrefUrl = resolveHref(href);
    const second = await fetchOne(hrefUrl, apiKey);
    return NextResponse.json({
      multi: true,
      results: [
        { endpoint: "audience_href_probe (audience)", ...first },
        { endpoint: "audience_href_probe (href)", ...second },
      ],
    });
  }

  if (endpoint === "engagement_rate") {
    if (!publisherId || !/^\d+$/.test(publisherId)) {
      return NextResponse.json(
        { error: "publisherId must be a non-empty numeric string" },
        { status: 400 }
      );
    }
    const result = await fetchCiqEngagementRate(publisherId);
    if (!result.ok) {
      return NextResponse.json({
        endpoint: "engagement_rate",
        ok: false,
        request: { url: "(engagement-rate job)", method: "GET" },
        response: {
          status: 502,
          headers: {},
          bodyTextTruncated: result.error,
          isJson: false,
        },
      });
    }
    const { metrics, startDate, endDate, report } = result;
    const bodyJson = {
      metrics,
      startDate,
      endDate,
      reportKeys: Object.keys(report),
    };
    return NextResponse.json({
      endpoint: "engagement_rate",
      ok: true,
      request: { url: "(engagement-rate job + report)", method: "GET" },
      response: {
        status: 200,
        headers: {},
        bodyTextTruncated: JSON.stringify(bodyJson),
        isJson: true,
        bodyJson,
      },
    });
  }

  if (endpoint === "account_info_link") {
    const link = typeof body.link === "string" ? body.link.trim() : "";
    if (!link) {
      return NextResponse.json(
        { error: "link is required for account_info_link" },
        { status: 400 }
      );
    }
    const info = await fetchCiqAccountInfoByLink(link);
    if (!info.ok) {
      return NextResponse.json({
        endpoint: "account_info_link",
        ok: false,
        request: { url: "(accountInfo by link)", method: "GET" },
        response: {
          status: 502,
          headers: {},
          bodyTextTruncated: info.error,
          isJson: false,
        },
      });
    }
    const { metrics, network, handle, url, ciqId } = normalizeAccountInfo(info.response);
    const bodyJson = {
      type: info.response.type ?? null,
      network,
      handle,
      url,
      ciq_account_id: ciqId,
      metrics,
      keys: Object.keys(info.response),
    };
    return NextResponse.json({
      endpoint: "account_info_link",
      ok: true,
      request: { url: "(accountInfo by link)", method: "GET" },
      response: {
        status: 200,
        headers: {},
        bodyTextTruncated: JSON.stringify(bodyJson),
        isJson: true,
        bodyJson,
      },
    });
  }

  const path = buildPath(endpoint, publisherId);
  if (!path) {
    return NextResponse.json(
      { error: `Unknown endpoint: ${endpoint}` },
      { status: 400 }
    );
  }

  const result = await fetchOne(path, apiKey);
  return NextResponse.json({ ...result, endpoint });
}
