import { GeminiCallError } from "@/lib/ai/gemini-call";

export type PartnershipResearchApiError = {
  error: string;
  retryable?: boolean;
  company_name?: string;
};

export function partnershipResearchErrorResponse(
  err: unknown,
  companyName: string
): { body: PartnershipResearchApiError; status: number } {
  if (err instanceof GeminiCallError) {
    return {
      status: err.retryable ? 503 : 502,
      body: {
        error: err.message,
        retryable: err.retryable,
        company_name: companyName,
      },
    };
  }
  const msg = err instanceof Error ? err.message : "AI synthesis failed";
  return {
    status: 502,
    body: { error: msg, retryable: false, company_name: companyName },
  };
}

export function formatPartnershipResearchClientError(data: unknown): string {
  if (!data || typeof data !== "object") return "Research failed";
  const rec = data as { error?: unknown; retryable?: unknown };
  const err = String(rec.error ?? "Research failed").trim();
  if (rec.retryable) return `${err} Tap Research to retry.`;
  return err;
}

export function partnershipResearchBulkDelayMs(): number {
  const raw = process.env.PARTNERSHIP_RESEARCH_BULK_DELAY_MS?.trim();
  const n = raw ? Number(raw) : 2500;
  if (!Number.isFinite(n) || n < 0) return 2500;
  return Math.min(n, 30000);
}

export function hasWebSearchProvider(): boolean {
  return Boolean(
    process.env.TAVILY_API_KEY?.trim() ||
      process.env.SERPAPI_API_KEY?.trim() ||
      (process.env.GOOGLE_CSE_API_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim())
  );
}

/** Default legacy (Tavily/SERP/CSE + Gemini) when web search is configured; else grounded. */
export function resolvePartnershipResearchBackend(): "grounded" | "legacy" {
  const explicit = process.env.PARTNERSHIP_RESEARCH_BACKEND?.trim().toLowerCase();
  if (explicit === "grounded" || explicit === "legacy") return explicit;
  return hasWebSearchProvider() ? "legacy" : "grounded";
}

export function formatNoPartnershipsMessage(opts: {
  research_backend: string;
  source_url_count: number;
  evidence_count: number;
}): string {
  if (opts.evidence_count > 0) {
    return `No partnerships extracted from ${opts.evidence_count} web sources. Add the company website or edit the field manually.`;
  }
  if (!hasWebSearchProvider()) {
    return "No relevant deals found. Set TAVILY_API_KEY (recommended) and GEMINI_API_KEY in your environment.";
  }
  if (opts.source_url_count > 0) {
    return "Search ran but no partnerships matched. Add the company website or edit manually.";
  }
  return "No relevant deals found. Add the company website on this row for better results.";
}
