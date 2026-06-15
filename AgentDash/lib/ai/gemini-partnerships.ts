import type { GenerateContentResponse, GroundingChunk } from "@google/genai";
import {
  generateContentWithRetry,
  isEmptyPartnershipResearch,
  PARTNERSHIP_RESEARCH_EMPTY_SENTINEL,
} from "@/lib/ai/gemini-call";
import { domainFromWebsiteHint, type PartnershipWebHit } from "@/lib/enrichment";

export { isEmptyPartnershipResearch };

const PARTNERSHIP_TITLE_RE =
  /sponsor|partnership|ambassador|endorse|athlete|collaboration|deal|team|league|creator|influencer|campaign|mlb|nfl|nba|nhl|pga|bassmaster/i;

export function isGroundingRedirectUrl(url: string): boolean {
  return /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(url);
}

export function citableUrlFromWebChunk(chunk: {
  uri?: string | null;
  domain?: string | null;
  title?: string | null;
}): string {
  const uri = String(chunk.uri ?? "").trim();
  if (uri && !isGroundingRedirectUrl(uri)) return uri;
  const domain = String(chunk.domain ?? "").trim().replace(/^www\./i, "");
  if (domain) return `https://${domain}`;
  return uri;
}

function isDomainOnlyTitle(title: string, domain?: string | null): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  const d = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./i, "");
  if (d && t === d) return true;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t);
}

export function groundingChunksToHits(chunks: GroundingChunk[]): PartnershipWebHit[] {
  const out: PartnershipWebHit[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web) continue;
    const title = String(web.title ?? "").trim();
    const domain = web.domain ?? null;
    if (!title || isDomainOnlyTitle(title, domain)) continue;
    if (!PARTNERSHIP_TITLE_RE.test(title)) continue;
    const url = citableUrlFromWebChunk({
      uri: web.uri,
      domain: web.domain,
      title: web.title,
    });
    if (!url || !url.startsWith("http") || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title, snippet: title });
  }
  return out;
}

export function mentionsBrand(text: string, brandName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const brand = normalize(brandName);
  if (!brand) return false;
  return normalize(text).includes(brand);
}

export function matchSourceToEvidence(sourceRef: string, hits: PartnershipWebHit[]): string | null {
  const ref = String(sourceRef ?? "").trim();
  if (!ref || hits.length === 0) return null;

  const asIndex = Number(ref);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= hits.length) {
    return hits[asIndex - 1]!.url;
  }

  const refHost = ref
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!refHost) return null;

  for (const hit of hits) {
    try {
      const host = new URL(hit.url).hostname.replace(/^www\./i, "").toLowerCase();
      if (host === refHost || host.endsWith(`.${refHost}`) || refHost.endsWith(`.${host}`)) {
        return hit.url;
      }
    } catch {
      if (hit.url.toLowerCase().includes(refHost)) return hit.url;
    }
  }
  return null;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sanitizePartnershipMarkdown(markdown: string, hits: PartnershipWebHit[]): string {
  let out = markdown
    .replace(/\*\*Sports marketing sources\*\*[\s\S]*$/i, "")
    .trim();

  out = out.replace(/\(https?:\/\/[^)]+\)/gi, (match) => {
    const inner = match.slice(1, -1);
    if (!isGroundingRedirectUrl(inner)) return match;
    const resolved = matchSourceToEvidence(inner, hits);
    return resolved ? `(${resolved})` : "";
  });

  out = out.replace(/https?:\/\/vertexaisearch\.cloud\.google\.com[^\s)\]]*/gi, (url) => {
    const resolved = matchSourceToEvidence(url, hits);
    return resolved ?? "";
  });

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function partnershipPrompt(companyName: string, websiteHint: string | null): string {
  const domain = domainFromWebsiteHint(websiteHint);
  const siteLine = domain ? `Official site hint: https://${domain}` : "Official site: unknown — prefer brand-name matches only.";
  return `Research past athlete, sports, team, and creator partnerships for "${companyName}" from roughly the last 3 years.

${siteLine}

Rules:
- Use only verifiable deals from the evidence or search results.
- Output markdown grouped by category headers like **Action sports** or **Team sports**.
- Each bullet: one concise factual line ending with a parenthetical source URL, e.g. "- Athlete X ambassador (https://example.com/article)"
- If nothing credible is found, output exactly: ${PARTNERSHIP_RESEARCH_EMPTY_SENTINEL}
- Do NOT invent partnerships.
- Do NOT add a "Sports marketing sources" section.
- Do NOT use vertexaisearch.cloud.google.com redirect URLs — use the real publisher URL.`;
}

function evidenceBlock(hits: PartnershipWebHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((h, i) => {
    const snippet = h.snippet?.trim() || h.title;
    return `[${i + 1}] ${h.title}\nURL: ${h.url}\nSnippet: ${snippet}`;
  });
  return `\n\nWeb evidence:\n${lines.join("\n\n")}`;
}

function extractResponseParts(response: GenerateContentResponse): {
  text: string;
  search_entry_point_html: string | null;
  web_search_queries: string[];
  source_urls: string[];
  grounding_hits: PartnershipWebHit[];
} {
  const candidate = response.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const groundingHits = groundingChunksToHits(chunks);
  const source_urls = [
    ...new Set([
      ...groundingHits.map((h) => h.url),
      ...chunks
        .map((c) => citableUrlFromWebChunk({
          uri: c.web?.uri,
          domain: c.web?.domain,
          title: c.web?.title,
        }))
        .filter((u) => u.startsWith("http") && !isGroundingRedirectUrl(u)),
    ]),
  ];

  return {
    text: String(response.text ?? "").trim(),
    search_entry_point_html: grounding?.searchEntryPoint?.renderedContent ?? null,
    web_search_queries: (grounding?.webSearchQueries ?? []).map(String),
    source_urls,
    grounding_hits: groundingHits,
  };
}

export async function synthesizePartnershipsFromHits(
  companyName: string,
  hits: PartnershipWebHit[],
  websiteHint?: string | null
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  if (hits.length === 0) return PARTNERSHIP_RESEARCH_EMPTY_SENTINEL;

  const brandFiltered = hits.filter(
    (h) => mentionsBrand(`${h.title} ${h.snippet}`, companyName) || !websiteHint
  );
  const evidence = brandFiltered.length > 0 ? brandFiltered : hits;

  const { response } = await generateContentWithRetry(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: `${partnershipPrompt(companyName, websiteHint ?? null)}${evidenceBlock(evidence)}` }],
      },
    ],
  });

  const raw = String(response.text ?? "").trim();
  const markdown = sanitizePartnershipMarkdown(raw, evidence);
  if (!markdown || isEmptyPartnershipResearch(markdown)) return PARTNERSHIP_RESEARCH_EMPTY_SENTINEL;
  return markdown;
}

export async function synthesizeGroundedPartnerships(
  companyName: string,
  websiteHint?: string | null
): Promise<{
  markdown: string;
  found: boolean;
  meta: {
    search_entry_point_html: string | null;
    web_search_queries: string[];
    source_urls: string[];
  };
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const domain = domainFromWebsiteHint(websiteHint ?? null);
  const searchHint = domain
    ? ` Focus on ${companyName} (${domain}) athlete, sports, and creator partnerships from 2023–2026.`
    : ` Focus on ${companyName} athlete, sports, and creator partnerships from 2023–2026.`;

  const { response } = await generateContentWithRetry(apiKey, {
    contents: [
      {
        role: "user",
        parts: [{ text: `${partnershipPrompt(companyName, websiteHint ?? null)}${searchHint}` }],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const parts = extractResponseParts(response);
  const hits =
    parts.grounding_hits.length > 0
      ? parts.grounding_hits
      : parts.source_urls.map((url) => ({
          url,
          title: hostnameFromUrl(url) || url,
          snippet: "",
        }));

  const markdown = sanitizePartnershipMarkdown(parts.text, hits);
  const found = Boolean(markdown) && !isEmptyPartnershipResearch(markdown);

  return {
    markdown: found ? markdown : PARTNERSHIP_RESEARCH_EMPTY_SENTINEL,
    found,
    meta: {
      search_entry_point_html: parts.search_entry_point_html,
      web_search_queries: parts.web_search_queries,
      source_urls: parts.source_urls,
    },
  };
}
