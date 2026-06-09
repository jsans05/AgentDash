import { fetchPartnershipWebEvidence, domainFromWebsiteHint, type PartnershipWebHit } from "@/lib/enrichment";
import {
  isEmptyPartnershipResearch,
  synthesizeGroundedPartnerships,
  synthesizePartnershipsFromHits,
} from "@/lib/ai/gemini-partnerships";
import { hasWebSearchProvider } from "@/lib/ai/partnership-research";

export type PartnershipResearchResult = {
  markdown: string;
  found: boolean;
  meta: {
    searchEntryPointHtml: string | null;
    webSearchQueries: string[];
    sourceUrls: string[];
    researchBackend: string;
    evidenceCount: number;
  };
};

/**
 * Primary partnership research: Tavily/SERP/CSE evidence → Gemini prose extraction → optional grounded supplement.
 */
export async function runPartnershipResearch(
  companyName: string,
  websiteHint?: string | null
): Promise<PartnershipResearchResult> {
  const emptyMeta = {
    searchEntryPointHtml: null as string | null,
    webSearchQueries: [] as string[],
    sourceUrls: [] as string[],
    researchBackend: "none",
    evidenceCount: 0,
  };

  if (!hasWebSearchProvider()) {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      throw new Error("Set TAVILY_API_KEY and GEMINI_API_KEY for partnership research.");
    }
    const grounded = await synthesizeGroundedPartnerships(companyName, websiteHint ?? null);
    return {
      markdown: grounded.markdown,
      found: grounded.found,
      meta: {
        searchEntryPointHtml: grounded.meta.search_entry_point_html,
        webSearchQueries: grounded.meta.web_search_queries,
        sourceUrls: grounded.meta.source_urls,
        researchBackend: "grounded_only",
        evidenceCount: grounded.meta.source_urls.length,
      },
    };
  }

  let hits: PartnershipWebHit[] = [];
  try {
    hits = await fetchPartnershipWebEvidence(companyName, { website: websiteHint ?? null });
  } catch (e) {
    throw e instanceof Error ? e : new Error("Web search failed");
  }

  const sourceUrls = hits.map((h) => h.url).filter(Boolean);
  let meta = {
    ...emptyMeta,
    sourceUrls,
    evidenceCount: hits.length,
    researchBackend: "legacy",
  };

  if (hits.length === 0) {
    return { markdown: "", found: false, meta };
  }

  let markdown = await synthesizePartnershipsFromHits(companyName, hits, websiteHint ?? null);
  let found = !isEmptyPartnershipResearch(markdown);

  if (!found && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const grounded = await synthesizeGroundedPartnerships(companyName, websiteHint ?? null);
      meta = {
        searchEntryPointHtml: grounded.meta.search_entry_point_html,
        webSearchQueries: grounded.meta.web_search_queries,
        sourceUrls: [...new Set([...sourceUrls, ...grounded.meta.source_urls])],
        researchBackend: "legacy_then_grounded",
        evidenceCount: Math.max(hits.length, grounded.meta.source_urls.length),
      };
      if (grounded.found && !isEmptyPartnershipResearch(grounded.markdown)) {
        markdown = grounded.markdown;
        found = true;
      }
    } catch {
      // keep legacy-empty result
    }
  }

  return { markdown, found, meta };
}

export function isAcceptablePartnershipMarkdown(block: string): boolean {
  if (isEmptyPartnershipResearch(block)) return false;
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(block)) return false;
  if (/\*\*Sports marketing sources\*\*/i.test(block)) return false;
  return true;
}

export function companyWebsiteHintFromParts(
  pipelineWebsite?: string | null,
  companyWebsite?: string | null
): string | undefined {
  const hint = [pipelineWebsite, companyWebsite].find((u) => u && String(u).trim());
  return hint ? String(hint).trim() : undefined;
}
