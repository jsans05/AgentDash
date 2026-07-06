export const CHAT_MODEL_TIERS = ["sonnet"] as const;
export type ChatModelTier = (typeof CHAT_MODEL_TIERS)[number];

/** Anthropic API model IDs (4.6 generation). */
export const CHAT_MODEL_IDS = {
  sonnet: "claude-sonnet-4-6",
} as const;

export const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "sonnet";

export const CHAT_MODEL_LABELS: Record<ChatModelTier, string> = {
  sonnet: "Sonnet 4.6",
};

export function parseChatModelTier(raw: unknown): ChatModelTier | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "sonnet") return value;
  return null;
}

export function resolveChatModelId(tier?: ChatModelTier | null): string {
  const resolved = tier ?? DEFAULT_CHAT_MODEL_TIER;
  return CHAT_MODEL_IDS[resolved];
}
