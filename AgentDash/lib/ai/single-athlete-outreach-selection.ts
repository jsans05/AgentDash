import { resolveAutoConfirmedPitchSelection } from "@/lib/ai/pitch-auto-interests";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import type { SuggestedPitchAngle } from "@/lib/ai/pitch-angle-curation";
import { pitchAnglesToInterestNames } from "@/lib/ai/pitch-angle-id";
import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";

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

function pitchAnglesFromSuggested(
  suggested_angles: SuggestedPitchAngle[] | undefined,
  includeWeak: boolean
): PitchAngle[] {
  const angles: PitchAngle[] = [];
  for (const angle of suggested_angles ?? []) {
    if (!includeWeak && angle.strength === "weak") continue;
    const converted = suggestedAngleToPitchAngle(angle);
    if (converted) angles.push(converted);
    if (angles.length >= 8) break;
  }
  return angles;
}

function interestNamesFromPitchAngles(pitchAngles: PitchAngle[]): string[] {
  const approved = pitchAnglesToInterestNames(pitchAngles);
  if (approved.length) return approved.slice(0, 3);

  const names: string[] = [];
  for (const angle of pitchAngles) {
    if (angle.kind !== "interest") continue;
    const name = String(angle.name ?? "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 3);
}

/** Resolve interest_names and pitch_angles from curation with auto-confirm + fallbacks. */
export function resolveSingleAthleteInterestSelection(
  curation: Pick<
    PitchInterestCurationResult,
    "suggested_interests" | "suggested_angles" | "mapped_valid_categories"
  >
): { interest_names: string[]; pitch_angles: PitchAngle[] } {
  const { pitchAngles, interestNames } = resolveAutoConfirmedPitchSelection(curation);
  let pitch_angles = pitchAngles.length ? pitchAngles : pitchAnglesFromSuggested(curation.suggested_angles, true);

  let interest_names = interestNames.map(String).filter(Boolean);
  if (!interest_names.length) {
    interest_names = curation.suggested_interests
      .map((s) => String(s.interest_name ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  if (!interest_names.length) {
    interest_names = interestNamesFromPitchAngles(pitch_angles);
  }
  if (!interest_names.length) {
    interest_names = (curation.mapped_valid_categories ?? []).slice(0, 3);
  }

  return {
    interest_names,
    pitch_angles,
  };
}
