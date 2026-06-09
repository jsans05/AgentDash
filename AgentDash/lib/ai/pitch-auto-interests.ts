import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";
import { APPROVED_INTEREST_CATEGORIES, type ApprovedInterestCategory } from "@/lib/ai/interest-taxonomy";

export type AutoConfirmInterestsOptions = {
  pipelineDrafting?: boolean;
};

export function pitchAutoConfirmGloballyEnabled(): boolean {
  const raw = process.env.PITCH_AUTO_CONFIRM_INTERESTS?.trim().toLowerCase();
  return raw === "always" || raw === "true" || raw === "on";
}

export function shouldAutoConfirmPitchInterests(
  curation: Pick<PitchInterestCurationResult, "interest_strength" | "suggested_interests">,
  opts: AutoConfirmInterestsOptions
): boolean {
  if (curation.interest_strength !== "strong" || curation.suggested_interests.length === 0) {
    return false;
  }
  if (pitchAutoConfirmGloballyEnabled()) return true;
  return opts.pipelineDrafting === true;
}

export function resolveAutoConfirmedInterests(
  curation: Pick<PitchInterestCurationResult, "suggested_interests">
): ApprovedInterestCategory[] {
  const approved = new Set<string>(APPROVED_INTEREST_CATEGORIES);
  const out: ApprovedInterestCategory[] = [];
  for (const s of curation.suggested_interests) {
    const name = String(s.interest_name ?? "").trim();
    if (!name || !approved.has(name)) continue;
    out.push(name as ApprovedInterestCategory);
    if (out.length >= 3) break;
  }
  return out;
}

function toTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseCurateResult(raw: string): PitchInterestCurationResult | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as PitchInterestCurationResult;
    if (Array.isArray(parsed?.suggested_interests)) return parsed;
  } catch {
    return null;
  }
  return null;
}

/** Latest curatePitchInterests tool JSON from the thread (if any). */
export function extractLatestCuratePitchInterestsFromMessages(
  messages: unknown[]
): PitchInterestCurationResult | null {
  if (!Array.isArray(messages)) return null;

  const toolContentByCallId = new Map<string, string>();
  for (const m of messages) {
    const row = m as { role?: string; tool_call_id?: string; content?: unknown };
    if (row?.role === "tool" && row.tool_call_id) {
      toolContentByCallId.set(String(row.tool_call_id), toTextContent(row.content));
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i] as {
      role?: string;
      tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
    };
    if (row?.role !== "assistant" || !Array.isArray(row.tool_calls)) continue;
    for (let j = row.tool_calls.length - 1; j >= 0; j--) {
      const call = row.tool_calls[j];
      if (String(call?.function?.name ?? "") !== "curatePitchInterests") continue;
      const raw = toolContentByCallId.get(String(call?.id ?? "")) ?? "";
      const parsed = parseCurateResult(raw);
      if (parsed) return parsed;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i] as { role?: string; content?: unknown };
    if (row?.role !== "tool") continue;
    const parsed = parseCurateResult(toTextContent(row.content));
    if (parsed) return parsed;
  }
  return null;
}

export function getPitchAutoConfirmAddon(interests: ApprovedInterestCategory[]): string {
  if (!interests.length) return "";
  return `

━━━ AUTO-CONFIRMED INTEREST CATEGORIES (CRM / strong curation) ━━━
Audience interests were auto-selected from brand mapping (user may change in a follow-up):
- ${interests.join("\n- ")}

You MUST call **composePitchEmail** in this turn (or the next tool iteration) with interest_names set to exactly these values.
Do **NOT** call **ask_user_question** for interest selection unless the user explicitly asks to change categories.
Briefly note which categories were auto-selected in one short sentence, then output the composed email.
`.trim();
}
