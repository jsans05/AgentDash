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
