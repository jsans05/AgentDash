import { ApiError, GoogleGenAI, type GenerateContentResponse } from "@google/genai";

export const PARTNERSHIP_RESEARCH_EMPTY_SENTINEL = "No relevant deals found.";

const DEFAULT_PRIMARY_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODELS = ["gemini-2.0-flash"];

const MAX_ATTEMPTS_PER_MODEL = 4;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;

export type GeminiGenerateContentRequest = {
  contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];
  config?: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["config"];
};

export class GeminiCallError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly model?: string;
  readonly rawMessage: string;

  constructor(opts: { message: string; retryable: boolean; statusCode?: number; model?: string; rawMessage?: string }) {
    super(opts.message);
    this.name = "GeminiCallError";
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    this.model = opts.model;
    this.rawMessage = opts.rawMessage ?? opts.message;
  }
}

export function isEmptyPartnershipResearch(block: string): boolean {
  return block.trim() === PARTNERSHIP_RESEARCH_EMPTY_SENTINEL;
}

export function getPartnershipModelChain(): string[] {
  const primary = process.env.GEMINI_PARTNERSHIPS_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;
  const fallbacksRaw = process.env.GEMINI_PARTNERSHIPS_FALLBACK_MODELS?.trim();
  const fallbacks = fallbacksRaw
    ? fallbacksRaw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : DEFAULT_FALLBACK_MODELS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [primary, ...fallbacks]) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function jitterMs(base: number): number {
  return base + Math.floor(Math.random() * 400);
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNestedErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string; code?: number; status?: string } };
    const nested = parsed?.error?.message;
    if (nested && typeof nested === "string") return nested;
  } catch {
    // ignore
  }
  return trimmed;
}

export function parseGeminiFailure(err: unknown): { retryable: boolean; statusCode?: number; message: string } {
  if (err instanceof GeminiCallError) {
    return { retryable: err.retryable, statusCode: err.statusCode, message: err.message };
  }

  if (err instanceof ApiError) {
    const message = extractNestedErrorMessage(err.message);
    return {
      retryable: isRetryableGeminiStatus(err.status, message),
      statusCode: err.status,
      message,
    };
  }

  const message = err instanceof Error ? extractNestedErrorMessage(err.message) : String(err ?? "Unknown error");
  const statusMatch = message.match(/\b(429|503)\b/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;
  return {
    retryable: isRetryableGeminiStatus(statusCode, message),
    statusCode,
    message,
  };
}

export function isRetryableGeminiStatus(statusCode: number | undefined, message: string): boolean {
  const lower = message.toLowerCase();
  if (statusCode === 429 || statusCode === 503) return true;
  if (lower.includes("high demand")) return true;
  if (lower.includes("resource_exhausted")) return true;
  if (lower.includes("unavailable")) return true;
  if (lower.includes("overloaded")) return true;
  if (lower.includes("rate limit")) return true;
  return false;
}

export function userFacingGeminiMessage(parsed: { message: string; retryable: boolean }): string {
  if (parsed.retryable) {
    return "Gemini is temporarily overloaded. Try again in a minute.";
  }
  return parsed.message || "AI synthesis failed";
}

/**
 * Call Gemini generateContent with per-model retries and a model fallback chain.
 */
export async function generateContentWithRetry(
  apiKey: string,
  request: GeminiGenerateContentRequest
): Promise<{ response: GenerateContentResponse; model: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const models = getPartnershipModelChain();
  let lastFailure: { retryable: boolean; statusCode?: number; message: string; model: string } | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: request.contents,
          config: request.config,
        });
        return { response, model };
      } catch (err) {
        const parsed = parseGeminiFailure(err);
        lastFailure = { ...parsed, model };

        if (!parsed.retryable) {
          throw new GeminiCallError({
            message: userFacingGeminiMessage(parsed),
            retryable: false,
            statusCode: parsed.statusCode,
            model,
            rawMessage: parsed.message,
          });
        }

        const isLastAttemptOnModel = attempt >= MAX_ATTEMPTS_PER_MODEL - 1;
        if (!isLastAttemptOnModel) {
          const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
          await sleepMs(jitterMs(backoff));
          continue;
        }
      }
    }
  }

  const parsed = lastFailure ?? { retryable: true, message: "Gemini request failed", statusCode: 503, model: models[0] ?? "" };
  throw new GeminiCallError({
    message: userFacingGeminiMessage(parsed),
    retryable: parsed.retryable,
    statusCode: parsed.statusCode ?? 503,
    model: parsed.model,
    rawMessage: parsed.message,
  });
}
