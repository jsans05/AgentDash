/**
 * Web enrichment for company prospecting (server-side only)
 * Supports Tavily (default), SERP API, Google CSE, Apollo org search
 */

import { companyDiscoveryProvider, isApolloEnabled } from "@/lib/apollo/config";
import type { ApolloOrganizationSearchFilters } from "@/lib/apollo/org-search-types";
import { enrichOrganizationByDomain, searchApolloOrganizations, searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";

const PROVIDER = (process.env.ENRICH_PROVIDER || "tavily") as "tavily" | "serpapi" | "google_cse";

export type CompanySearchFilters = Pick<
  ApolloOrganizationSearchFilters,
  | "revenue_range_min"
  | "revenue_range_max"
  | "organization_locations"
  | "organization_num_employees_ranges"
  | "keyword_tags"
  | "per_page"
>;

export async function searchCompanies(
  query: string,
  filters?: CompanySearchFilters
): Promise<
  Array<{
    name: string;
    industry?: string;
    website?: string;
    description?: string;
    apollo_organization_id?: string;
    annual_revenue?: number;
    estimated_num_employees?: number;
  }>
> {
  const discovery = companyDiscoveryProvider();
  if (discovery === "apollo") {
    try {
      const tags = filters?.keyword_tags?.length
        ? filters.keyword_tags
        : [query.trim()].filter(Boolean);
      const { organizations } = await searchApolloOrganizationsAdvanced({
        keyword_tags: tags,
        revenue_range_min: filters?.revenue_range_min,
        revenue_range_max: filters?.revenue_range_max,
        organization_locations: filters?.organization_locations,
        organization_num_employees_ranges: filters?.organization_num_employees_ranges,
        per_page: filters?.per_page ?? 15,
      });
      if (organizations.length > 0) {
        return organizations.map((o) => ({
          name: o.name,
          industry: o.industry,
          website: o.website,
          description: o.description,
          apollo_organization_id: o.apollo_organization_id ?? undefined,
          annual_revenue: o.annual_revenue,
          estimated_num_employees: o.estimated_num_employees,
        }));
      }
      const legacy = await searchApolloOrganizations(query, {
        revenue_range_min: filters?.revenue_range_min,
        revenue_range_max: filters?.revenue_range_max,
        per_page: filters?.per_page,
      });
      if (legacy.length > 0) return legacy;
    } catch {
      // fall through to Tavily/SERP/CSE
    }
  }

  switch (PROVIDER) {
    case "tavily":
      return searchTavily(query);
    case "serpapi":
      return searchSerpAPI(query);
    case "google_cse":
      return searchGoogleCSE(query);
    default:
      return searchTavily(query);
  }
}

export async function enrichCompanyProfile(
  companyName: string
): Promise<{ website: string | null; instagram_url: string | null; support_email: string | null; raw_snippets: string[] }> {
  if (isApolloEnabled() && companyDiscoveryProvider() === "apollo") {
    const rows = await searchCompanies(companyName);
    const website = rows[0]?.website ?? null;
    const support_email: string | null = null;
    let raw_snippets = (rows ?? []).map((r) => `${r.name ?? ""} ${r.description ?? ""}`.trim()).filter(Boolean);

    if (website) {
      try {
        const domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(
          /^www\./i,
          ""
        );
        const enriched = await enrichOrganizationByDomain(domain);
        raw_snippets = [
          ...raw_snippets,
          enriched.description ?? "",
          enriched.industry ?? "",
        ].filter(Boolean);
      } catch {
        // ignore domain enrich errors
      }
    }

    return {
      website,
      instagram_url: null,
      support_email,
      raw_snippets,
    };
  }

  if (PROVIDER !== "tavily") {
    const rows = await searchCompanies(companyName);
    return {
      website: rows[0]?.website ?? null,
      instagram_url: null,
      support_email: null,
      raw_snippets: (rows ?? []).map((r) => `${r.name ?? ""} ${r.description ?? ""}`.trim()).filter(Boolean),
    };
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set");
  }

  async function runQuery(query: string) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        max_results: 6,
      }),
    });
    if (!res.ok) throw new Error(`Tavily API error: ${res.statusText}`);
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  }

  const [companyResults, instaResults, supportResults] = await Promise.all([
    runQuery(`${companyName} official website`),
    runQuery(`${companyName} instagram`),
    runQuery(`${companyName} support email contact`),
  ]);

  const website = (companyResults.find((r: any) => String(r.url ?? "").startsWith("http"))?.url ?? null) as string | null;

  const instaUrl =
    (instaResults.find((r: any) => String(r.url ?? "").toLowerCase().includes("instagram.com"))?.url ?? null) as string | null;

  const snippets = [...companyResults, ...instaResults, ...supportResults]
    .map((r: any) => `${r.title ?? ""} ${r.content ?? ""}`)
    .filter(Boolean);

  const emails = snippets
    .join(" ")
    .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
    ?.map((e) => e.toLowerCase()) ?? [];

  const supportEmail =
    emails.find((e) => /^support@|^hello@|^info@|^contact@|^partnerships@/i.test(e)) ?? emails[0] ?? null;

  return {
    website,
    instagram_url: instaUrl,
    support_email: supportEmail,
    raw_snippets: snippets.slice(0, 10),
  };
}

async function searchTavily(query: string) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set");
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: `${query} company`,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
        max_results: 15,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily API error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.results || []).map((r: any) => ({
    name: r.title?.replace(/ - .*$/, "").trim() || "Unknown",
    website: r.url,
    description: r.content,
  }));
}

async function searchSerpAPI(query: string) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY not set");
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", `${query} company`);
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(`SERP API error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.organic_results || []).slice(0, 15).map((r: any) => ({
    name: r.title,
    website: r.link,
    description: r.snippet,
  }));
}

async function searchGoogleCSE(query: string) {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) {
    throw new Error("GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX required");
  }

  const baseUrl = new URL("https://www.googleapis.com/customsearch/v1");
  baseUrl.searchParams.set("cx", cx);
  baseUrl.searchParams.set("q", `${query} company`);

  const res = await fetch(baseUrl.toString(), {
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Google CSE error: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.items || []).slice(0, 15).map((r: any) => ({
    name: r.title,
    website: r.link,
    description: r.snippet,
  }));
}

/** Snippets for partnership research (athletes, sports, talent) — grounded in search only. */
export type PartnershipWebHit = { url: string; title: string; snippet: string };

const PARTNERSHIP_EVIDENCE_CAP = 28;

export function domainFromWebsiteHint(websiteHint: string | null | undefined): string | null {
  const raw = String(websiteHint ?? "").trim();
  if (!raw) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProto).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function dedupeHits(hits: PartnershipWebHit[]): PartnershipWebHit[] {
  const seen = new Set<string>();
  const out: PartnershipWebHit[] = [];
  for (const h of hits) {
    const u = String(h.url ?? "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push({
      url: u,
      title: String(h.title ?? "").trim() || u,
      snippet: String(h.snippet ?? "").trim(),
    });
    if (out.length >= PARTNERSHIP_EVIDENCE_CAP) break;
  }
  return out;
}

async function tavilyPartnershipQueries(companyName: string, websiteHint: string | null): Promise<PartnershipWebHit[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set");
  }

  const safeName = companyName.replace(/"/g, "").trim();
  const domain = domainFromWebsiteHint(websiteHint);

  const altName = /hartt/i.test(safeName.replace(/[^a-z]/gi, "")) ? "Carhartt" : safeName;

  const queries: Array<{ q: string; withAnswer?: boolean }> = [
    {
      q: `${altName} athlete sponsorship sports partnership MLB NFL NBA NHL Bassmaster fishing 2023 2024 2025`,
      withAnswer: true,
    },
    { q: `"${altName}" athlete ambassador endorsement sports team sponsorship` },
    { q: `${altName} '47 headwear MLB NFL sports collaboration partnership` },
    { q: `${altName} Bassmaster OR PGA OR grounds crew OR stadium partnership apparel` },
    { q: `${altName} influencer creator collaboration campaign partnership` },
    { q: `${safeName} corporate nonprofit collaboration sponsorship deal` },
    ...(domain
      ? [
          { q: `site:${domain} partnership OR sponsor OR athlete OR ambassador OR collaboration` },
          { q: `site:${domain} ${altName} news` },
        ]
      : []),
  ];

  const extraHits: PartnershipWebHit[] = [];

  async function runOne(query: string, withAnswer = false): Promise<PartnershipWebHit[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        include_answer: withAnswer,
        include_raw_content: false,
        max_results: 10,
      }),
    });
    if (!res.ok) throw new Error(`Tavily API error: ${res.statusText}`);
    const data = await res.json();
    if (withAnswer && typeof data.answer === "string" && data.answer.trim().length > 40) {
      const answerUrl = domain ? `https://${domain}/` : "";
      if (answerUrl) {
        extraHits.push({
          url: answerUrl,
          title: `${altName} — partnership research summary`,
          snippet: data.answer.trim(),
        });
      }
    }
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((r: any) => ({
      url: String(r.url ?? "").trim(),
      title: String(r.title ?? "").trim(),
      snippet: String(r.content ?? r.snippet ?? "").trim(),
    }));
  }

  const batches = await Promise.all(queries.map(({ q, withAnswer }) => runOne(q, withAnswer)));
  return dedupeHits([...extraHits, ...batches.flat()].filter((h) => h.url.startsWith("http")));
}

async function serpPartnershipQueries(companyName: string): Promise<PartnershipWebHit[]> {
  const serpKeyRaw = process.env.SERPAPI_API_KEY;
  if (!serpKeyRaw) {
    throw new Error("SERPAPI_API_KEY not set");
  }
  const serpKey: string = serpKeyRaw;

  const safeName = companyName.replace(/"/g, "").trim();
  const queries = [
    `"${safeName}" sponsorship partnership athlete 2024`,
    `"${safeName}" action sports sponsor`,
    `"${safeName}" influencer ambassador deal`,
  ];

  async function runOne(q: string): Promise<PartnershipWebHit[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("q", q);
    url.searchParams.set("api_key", serpKey);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`SERP API error: ${res.statusText}`);
    const data = await res.json();
    return (data.organic_results || []).slice(0, 8).map((r: any) => ({
      url: String(r.link ?? "").trim(),
      title: String(r.title ?? "").trim(),
      snippet: String(r.snippet ?? "").trim(),
    }));
  }

  const batches = await Promise.all(queries.map((q) => runOne(q)));
  return dedupeHits(batches.flat().filter((h) => h.url.startsWith("http")));
}

async function csePartnershipQueries(companyName: string): Promise<PartnershipWebHit[]> {
  const cseKeyRaw = process.env.GOOGLE_CSE_API_KEY;
  const cseCxRaw = process.env.GOOGLE_CSE_CX;
  if (!cseKeyRaw || !cseCxRaw) {
    throw new Error("GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX required");
  }
  const cseKey: string = cseKeyRaw;
  const cseCx: string = cseCxRaw;

  const safeName = companyName.replace(/"/g, "").trim();
  const queries = [
    `"${safeName}" athlete sponsorship partnership`,
    `"${safeName}" action sports sponsor`,
    `"${safeName}" brand ambassador influencer`,
  ];

  async function runOne(q: string): Promise<PartnershipWebHit[]> {
    const baseUrl = new URL("https://www.googleapis.com/customsearch/v1");
    baseUrl.searchParams.set("cx", cseCx);
    baseUrl.searchParams.set("q", q);
    const res = await fetch(baseUrl.toString(), {
      headers: { "x-goog-api-key": cseKey },
    });
    if (!res.ok) throw new Error(`Google CSE error: ${res.statusText}`);
    const data = await res.json();
    return (data.items || []).slice(0, 8).map((r: any) => ({
      url: String(r.link ?? "").trim(),
      title: String(r.title ?? "").trim(),
      snippet: String(r.snippet ?? "").trim(),
    }));
  }

  const batches = await Promise.all(queries.map((q) => runOne(q)));
  return dedupeHits(batches.flat().filter((h) => h.url.startsWith("http")));
}

/**
 * Web search hits for partnership synthesis (2023–present oriented queries).
 * Uses the same ENRICH_PROVIDER as company discovery (tavily | serpapi | google_cse).
 */
export async function fetchPartnershipWebEvidence(
  companyName: string,
  opts?: { website?: string | null }
): Promise<PartnershipWebHit[]> {
  const name = String(companyName ?? "").trim();
  if (!name) return [];

  switch (PROVIDER) {
    case "tavily":
      return tavilyPartnershipQueries(name, opts?.website ?? null);
    case "serpapi":
      return serpPartnershipQueries(name);
    case "google_cse":
      return csePartnershipQueries(name);
    default:
      return tavilyPartnershipQueries(name, opts?.website ?? null);
  }
}
