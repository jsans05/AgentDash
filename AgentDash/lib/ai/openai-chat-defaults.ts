/** @deprecated Use llm-chat-defaults — kept for existing import paths during Claude migration. */
export {
  ANTHROPIC_CHAT_MODEL as OPENAI_CHAT_MODEL,
  ANTHROPIC_PITCH_POLISH_MAX_TOKENS,
  PITCH_POLISH_TIMEOUT_MS,
} from "@/lib/ai/llm-chat-defaults";

/** Claude has no OpenAI-style reasoning_effort knob; retained for call-site compatibility. */
export const OPENAI_REASONING_EFFORT = "high" as const;
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORT;
export const OPENAI_PITCH_POLISH_REASONING_EFFORT: OpenAIReasoningEffort | null = null;
