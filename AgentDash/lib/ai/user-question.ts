import { z } from "zod";
import {
  expandInterestPickerOptionsIfNeeded,
  INTEREST_PICKER_OPTION_CAP,
  isInterestCategoryPickerQuestion,
} from "@/lib/ai/interest-picker";

export const ASK_USER_QUESTION_TOOL = "ask_user_question";
export const USER_QUESTION_OTHER_ID = "__other__";

export type UserQuestionOption = { id: string; label: string };

export type UserQuestionPrompt = {
  type: "multi_select";
  question: string;
  options: UserQuestionOption[];
  allow_multiple: boolean;
  allow_other: boolean;
  allow_skip: boolean;
  min_selections?: number;
  max_selections?: number;
};

export type AIMessageInteractionMetadata = {
  interaction?: UserQuestionPrompt;
  interaction_status?: "pending" | "answered" | "expired";
  tool_call_id?: string;
  interaction_answer?: {
    selected_ids: string[];
    labels: string[];
    other_text?: string;
    skipped?: boolean;
    dismissed?: boolean;
  };
};

export type PendingTurnState = {
  tool_call_id: string;
  prompt: UserQuestionPrompt;
  assistant_content: string;
  model_messages: unknown[];
};

const optionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(200),
});

export const askUserQuestionArgsSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(optionSchema).min(2).max(INTEREST_PICKER_OPTION_CAP),
  allow_multiple: z.boolean().optional().default(true),
  allow_other: z.boolean().optional().default(false),
  allow_skip: z.boolean().optional().default(true),
  min_selections: z.number().int().min(0).max(20).optional(),
  max_selections: z.number().int().min(1).max(20).optional(),
});

export const interactionResponseSchema = z.object({
  conversation_id: z.string().trim().min(1).max(120),
  tool_call_id: z.string().trim().min(1).max(120),
  selected_ids: z.array(z.string().trim().max(120)).max(50),
  other_text: z.string().trim().max(500).optional(),
  skipped: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});

export type InteractionResponsePayload = z.infer<typeof interactionResponseSchema>;

function preprocessInterestPickerArgs(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const question = String(r.question ?? "");
  if (!isInterestCategoryPickerQuestion(question)) return raw;

  const rawOpts = Array.isArray(r.options) ? r.options : [];
  const opts: UserQuestionOption[] = [];
  for (const o of rawOpts) {
    if (!o || typeof o !== "object") continue;
    const row = o as Record<string, unknown>;
    const id = String(row.id ?? row.label ?? "").trim();
    const label = String(row.label ?? row.id ?? "").trim();
    if (id && label) opts.push({ id, label });
  }
  r.options = expandInterestPickerOptionsIfNeeded(question, opts);
  return r;
}

export function parseAskUserQuestionToolArgs(raw: unknown): UserQuestionPrompt {
  const parsed = askUserQuestionArgsSchema.parse(preprocessInterestPickerArgs(raw));
  const ids = new Set<string>();
  for (const o of parsed.options) {
    if (ids.has(o.id)) {
      throw new Error(`Duplicate option id "${o.id}"`);
    }
    ids.add(o.id);
  }
  const minSel = parsed.min_selections ?? (parsed.allow_multiple ? 0 : 1);
  const maxSel = parsed.max_selections ?? (parsed.allow_multiple ? parsed.options.length : 1);
  if (maxSel < minSel) {
    throw new Error("max_selections must be >= min_selections");
  }
  let options = [...parsed.options];
  if (parsed.allow_other) {
    options.push({ id: USER_QUESTION_OTHER_ID, label: "Something else" });
  }
  const isInterestPicker = isInterestCategoryPickerQuestion(parsed.question);
  return {
    type: "multi_select",
    question: parsed.question,
    options,
    allow_multiple: parsed.allow_multiple,
    allow_other: parsed.allow_other,
    allow_skip: isInterestPicker ? false : parsed.allow_skip,
    min_selections: minSel,
    max_selections: maxSel,
  };
}

export function buildAskUserQuestionToolResult(
  prompt: UserQuestionPrompt,
  response: InteractionResponsePayload
): {
  selected: UserQuestionOption[];
  other_text: string | null;
  skipped: boolean;
  dismissed: boolean;
} {
  const skipped = Boolean(response.skipped);
  const dismissed = Boolean(response.dismissed);
  if (skipped || dismissed) {
    return { selected: [], other_text: null, skipped, dismissed };
  }
  const idToOption = new Map(prompt.options.map((o) => [o.id, o]));
  const selected: UserQuestionOption[] = [];
  let otherText: string | null = null;
  for (const id of response.selected_ids) {
    const opt = idToOption.get(id);
    if (!opt) continue;
    if (id === USER_QUESTION_OTHER_ID) {
      otherText = String(response.other_text ?? "").trim() || null;
      selected.push({ id, label: otherText ? `Something else: ${otherText}` : "Something else" });
    } else {
      selected.push(opt);
    }
  }
  return { selected, other_text: otherText, skipped: false, dismissed: false };
}

export function formatInteractionUserSummary(
  prompt: UserQuestionPrompt,
  response: InteractionResponsePayload
): string {
  const result = buildAskUserQuestionToolResult(prompt, response);
  if (result.skipped) return "_Skipped the selection prompt._";
  if (result.dismissed) return "_Dismissed the selection prompt._";
  if (result.selected.length === 0) return "_Submitted with no selections._";
  const labels = result.selected.map((s) => s.label).join(", ");
  return `Selected: ${labels}`;
}

export function parseMessageMetadata(raw: unknown): AIMessageInteractionMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as AIMessageInteractionMetadata;
  if (m.interaction?.type === "multi_select") return m;
  return null;
}

export function isPendingTurnState(value: unknown): value is PendingTurnState {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PendingTurnState).tool_call_id === "string" &&
    Array.isArray((value as PendingTurnState).model_messages)
  );
}

const MAX_PENDING_TOOL_CHARS = 12_000;
const MAX_PENDING_MODEL_MESSAGES = 24;

/** Shrink tool payloads before storing pending_turn (resume still works; avoids DB update failures). */
export function trimModelMessagesForPendingTurn(messages: unknown[]): unknown[] {
  const sliced = Array.isArray(messages) ? messages.slice(-MAX_PENDING_MODEL_MESSAGES) : [];
  return sliced.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    const m = msg as Record<string, unknown>;
    if (m.role === "tool" && typeof m.content === "string" && m.content.length > MAX_PENDING_TOOL_CHARS) {
      return {
        ...m,
        content: `${m.content.slice(0, MAX_PENDING_TOOL_CHARS)}\n...(truncated for storage)`,
      };
    }
    return msg;
  });
}

export const PENDING_INTERACTION_STALE_ERROR =
  "This selection prompt expired. Refresh the page, then send your email request again—or type your category picks as a normal message.";
