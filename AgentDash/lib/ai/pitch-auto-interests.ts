import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";
import type { SuggestedPitchAngle } from "@/lib/ai/pitch-angle-curation";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import { APPROVED_INTEREST_CATEGORIES, type ApprovedInterestCategory } from "@/lib/ai/interest-taxonomy";

export type AutoConfirmedPitchSelection = {
  pitchAngles: PitchAngle[];
  interestNames: ApprovedInterestCategory[];
};

function angleStrengthRank(strength: SuggestedPitchAngle["strength"]): number {
  if (strength === "strong") return 3;
  if (strength === "medium") return 2;
  return 1;
}

function suggestedAngleToPitchAngle(angle: SuggestedPitchAngle): PitchAngle | null {
  const value = String(angle.value ?? "").trim();
  if (!value) return null;
  switch (angle.kind) {
    case "interest":
      return { kind: "interest", name: value };
    case "age":
      return { kind: "age", cohort: value };
    case "gender":
      return { kind: "gender", value };
    case "country":
      return { kind: "country", name: value };
    case "brand_affinity":
      return { kind: "brand_affinity", brand: value };
    default:
      return null;
  }
}

function formatPitchAngleLabel(angle: PitchAngle): string {
  switch (angle.kind) {
    case "interest":
      return `interest: ${angle.name}`;
    case "age":
      return `age: ${angle.cohort}`;
    case "gender":
      return `gender: ${angle.value}`;
    case "country":
      return `country: ${angle.name}`;
    case "brand_affinity":
      return `brand_affinity: ${angle.brand}`;
    default:
      return "";
  }
}

export function shouldAutoConfirmPitchInterests(
  curation: Pick<PitchInterestCurationResult, "interest_strength" | "suggested_interests" | "suggested_angles">
): boolean {
  if (curation.interest_strength !== "strong") return false;
  const hasInterests = curation.suggested_interests.length > 0;
  const hasAngles = Array.isArray(curation.suggested_angles) && curation.suggested_angles.length > 0;
  return hasInterests || hasAngles;
}

export function resolveAutoConfirmedPitchSelection(
  curation: Pick<PitchInterestCurationResult, "suggested_interests" | "suggested_angles">
): AutoConfirmedPitchSelection {
  const approved = new Set<string>(APPROVED_INTEREST_CATEGORIES);
  const pitchAngles: PitchAngle[] = [];
  const interestNames: ApprovedInterestCategory[] = [];

  const suggestedAngles = Array.isArray(curation.suggested_angles) ? curation.suggested_angles : [];
  if (suggestedAngles.length > 0) {
    const ranked = [...suggestedAngles]
      .filter((angle) => angle.strength === "strong" || angle.strength === "medium")
      .sort((a, b) => angleStrengthRank(b.strength) - angleStrengthRank(a.strength));

    for (const angle of ranked) {
      const converted = suggestedAngleToPitchAngle(angle);
      if (!converted) continue;
      pitchAngles.push(converted);
      if (
        converted.kind === "interest" &&
        approved.has(converted.name) &&
        !interestNames.includes(converted.name as ApprovedInterestCategory)
      ) {
        interestNames.push(converted.name as ApprovedInterestCategory);
      }
      if (pitchAngles.length >= 8) break;
    }
  }

  if (interestNames.length === 0) {
    for (const suggestion of curation.suggested_interests) {
      const name = String(suggestion.interest_name ?? "").trim();
      if (!name || !approved.has(name)) continue;
      interestNames.push(name as ApprovedInterestCategory);
      if (!pitchAngles.some((angle) => angle.kind === "interest" && angle.name === name)) {
        pitchAngles.push({ kind: "interest", name });
      }
      if (interestNames.length >= 3) break;
    }
  }

  return {
    pitchAngles: pitchAngles.slice(0, 8),
    interestNames: interestNames.slice(0, 3),
  };
}

export function resolveAutoConfirmedInterests(
  curation: Pick<PitchInterestCurationResult, "suggested_interests" | "suggested_angles">
): ApprovedInterestCategory[] {
  return resolveAutoConfirmedPitchSelection(curation).interestNames;
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

export function getPitchAutoConfirmAddon(selection: AutoConfirmedPitchSelection): string {
  if (!selection.pitchAngles.length && !selection.interestNames.length) return "";

  const displayLines =
    selection.pitchAngles.length > 0
      ? selection.pitchAngles.map(formatPitchAngleLabel)
      : selection.interestNames.map((name) => `interest: ${name}`);

  const pitchAnglesJson = JSON.stringify(selection.pitchAngles, null, 2);
  const interestNamesJson = JSON.stringify(selection.interestNames);

  return `

━━━ AUTO-CONFIRMED AUDIENCE ANGLES (strong curation) ━━━
Audience angles auto-confirmed from curation (strong signal):
- ${displayLines.join("\n- ")}

Call **composePitchEmail** with **pitch_angles** set to these angles in this turn:
${pitchAnglesJson}
Also pass interest_names: ${interestNamesJson} (required tool param).
Do **NOT** invoke **ask_user_question** for interest/angle selection unless the user explicitly asks to change them.
Briefly note which angles were auto-selected in one short sentence, then output the composed email body_markdown.
`.trim();
}

export function getCurateAutoConfirmComposeHint(selection: AutoConfirmedPitchSelection): string {
  if (!selection.pitchAngles.length && !selection.interestNames.length) return "";
  const parts: string[] = [];
  if (selection.pitchAngles.length) {
    parts.push(`pitch_angles: ${JSON.stringify(selection.pitchAngles)}`);
  }
  if (selection.interestNames.length) {
    parts.push(`interest_names: ${JSON.stringify(selection.interestNames)}`);
  }
  return `Audience angles were auto-confirmed from strong curation. Call composePitchEmail now with ${parts.join(" and ")} and athlete_ids from SESSION CONTEXT. Output only the tool body_markdown. Do not invoke ask_user_question.`;
}
