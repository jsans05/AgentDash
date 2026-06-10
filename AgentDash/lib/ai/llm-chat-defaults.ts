import { CHAT_MODEL_IDS, DEFAULT_CHAT_MODEL_TIER } from "@/lib/ai/chat-model";

const DEFAULT_MAX_TOKENS = 16_384;

export const ANTHROPIC_CHAT_MODEL =
  process.env.ANTHROPIC_CHAT_MODEL?.trim() ||
  process.env.CLAUDE_CHAT_MODEL?.trim() ||
  CHAT_MODEL_IDS[DEFAULT_CHAT_MODEL_TIER];

export const ANTHROPIC_MAX_TOKENS = Math.max(
  256,
  Math.min(64_000, Number(process.env.ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS)
);

/** Pitch polish is a short prose pass — keep output bounded for fast tool turns. */
export const ANTHROPIC_PITCH_POLISH_MAX_TOKENS = Math.max(
  256,
  Math.min(4_096, Number(process.env.ANTHROPIC_PITCH_POLISH_MAX_TOKENS) || 1_600)
);

export const PITCH_POLISH_TIMEOUT_MS = Math.max(
  15_000,
  Math.min(120_000, Number(process.env.PITCH_POLISH_TIMEOUT_MS) || 45_000)
);

export function getAnthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key || null;
}
