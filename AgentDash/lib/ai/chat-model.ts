export const CHAT_MODEL_TIERS = ["sonnet", "opus"] as const;
export type ChatModelTier = (typeof CHAT_MODEL_TIERS)[number];

/** Anthropic API model IDs (4.6 generation). */
export const CHAT_MODEL_IDS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
} as const;

export const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "sonnet";

export const CHAT_MODEL_LABELS: Record<ChatModelTier, string> = {
  sonnet: "Sonnet 4.6",
  opus: "Opus 4.8",
};

export const CHAT_MODEL_STORAGE_KEY = "agentdash.chat_model";

export function parseChatModelTier(raw: unknown): ChatModelTier | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "sonnet" || value === "opus") return value;
  return null;
}

export function resolveChatModelId(tier?: ChatModelTier | null): string {
  const resolved = tier ?? DEFAULT_CHAT_MODEL_TIER;
  return CHAT_MODEL_IDS[resolved];
}

export function readStoredChatModelTier(): ChatModelTier {
  if (typeof window === "undefined") return DEFAULT_CHAT_MODEL_TIER;
  return parseChatModelTier(localStorage.getItem(CHAT_MODEL_STORAGE_KEY)) ?? DEFAULT_CHAT_MODEL_TIER;
}

export function storeChatModelTier(tier: ChatModelTier): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CHAT_MODEL_STORAGE_KEY, tier);
}
