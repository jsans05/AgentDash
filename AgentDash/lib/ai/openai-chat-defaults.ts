const DEFAULT_CHAT_MODEL = "gpt-5.4";
const DEFAULT_REASONING_EFFORT = "xhigh";

export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
export const OPENAI_REASONING_EFFORT =
  (process.env.OPENAI_REASONING_EFFORT?.trim() || DEFAULT_REASONING_EFFORT) as
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";

/** Pitch polish is a short prose pass — use low/none so composePitchEmail tools finish in seconds, not minutes. */
export type OpenAIReasoningEffort = typeof OPENAI_REASONING_EFFORT;

const PITCH_POLISH_REASONING_RAW = process.env.OPENAI_PITCH_POLISH_REASONING_EFFORT?.trim() || "low";

export const OPENAI_PITCH_POLISH_REASONING_EFFORT: OpenAIReasoningEffort | null =
  PITCH_POLISH_REASONING_RAW === "off" || PITCH_POLISH_REASONING_RAW === "false"
    ? null
    : (PITCH_POLISH_REASONING_RAW as OpenAIReasoningEffort);

export const PITCH_POLISH_TIMEOUT_MS = Math.max(
  15_000,
  Math.min(120_000, Number(process.env.PITCH_POLISH_TIMEOUT_MS) || 45_000)
);
