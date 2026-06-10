import test from "node:test";
import assert from "node:assert/strict";
import {
  getCurateAutoConfirmComposeHint,
  getPitchAutoConfirmAddon,
  resolveAutoConfirmedInterests,
  resolveAutoConfirmedPitchSelection,
  shouldAutoConfirmPitchInterests,
} from "@/lib/ai/pitch-auto-interests";
import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";

const strongCuration: Pick<
  PitchInterestCurationResult,
  "interest_strength" | "suggested_interests" | "suggested_angles"
> = {
  interest_strength: "strong",
  suggested_interests: [
    { interest_name: "Electronics & Computers", athlete_pct: 10, roster_audience_count: null, roster_athlete_count: null },
    { interest_name: "Sports", athlete_pct: 8, roster_audience_count: null, roster_athlete_count: null },
  ],
  suggested_angles: [
    { kind: "interest", value: "Fitness & Yoga", strength: "strong" },
    { kind: "age", value: "25-34", strength: "strong" },
    { kind: "gender", value: "female", strength: "medium" },
  ],
};

test("shouldAutoConfirmPitchInterests when strong regardless of pipeline drafting", () => {
  assert.equal(shouldAutoConfirmPitchInterests(strongCuration), true);
  assert.equal(
    shouldAutoConfirmPitchInterests({
      interest_strength: "weak",
      suggested_interests: strongCuration.suggested_interests,
      suggested_angles: strongCuration.suggested_angles,
    }),
    false
  );
});

test("resolveAutoConfirmedPitchSelection prefers suggested_angles", () => {
  const selection = resolveAutoConfirmedPitchSelection(strongCuration);
  assert.ok(selection.pitchAngles.some((angle) => angle.kind === "age"));
  assert.ok(selection.pitchAngles.some((angle) => angle.kind === "gender"));
});

test("resolveAutoConfirmedInterests falls back to suggested_interests", () => {
  const picks = resolveAutoConfirmedInterests({
    interest_strength: "strong",
    suggested_interests: strongCuration.suggested_interests,
    suggested_angles: [],
  });
  assert.deepEqual(picks, ["Electronics & Computers", "Sports"]);
});

test("getPitchAutoConfirmAddon instructs composePitchEmail.pitch_angles", () => {
  const selection = resolveAutoConfirmedPitchSelection(strongCuration);
  const addon = getPitchAutoConfirmAddon(selection);
  assert.match(addon, /pitch_angles/);
  assert.match(addon, /ask_user_question/);
  assert.match(addon, /25-34/);
});

test("getCurateAutoConfirmComposeHint includes pitch_angles payload", () => {
  const selection = resolveAutoConfirmedPitchSelection(strongCuration);
  const hint = getCurateAutoConfirmComposeHint(selection);
  assert.match(hint, /pitch_angles/);
  assert.match(hint, /composePitchEmail/);
});
