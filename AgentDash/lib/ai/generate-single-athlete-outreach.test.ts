import test from "node:test";
import assert from "node:assert/strict";
import { resolveSingleAthleteInterestSelection } from "@/lib/ai/single-athlete-outreach-selection";
import { resolveAutoConfirmedPitchSelection } from "@/lib/ai/pitch-auto-interests";
import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";

const strongCuration: Pick<
  PitchInterestCurationResult,
  "suggested_interests" | "suggested_angles" | "mapped_valid_categories"
> = {
  suggested_interests: [
    { interest_name: "Electronics & Computers", athlete_pct: 10, roster_audience_count: null, roster_athlete_count: null },
    { interest_name: "Sports", athlete_pct: 8, roster_audience_count: null, roster_athlete_count: null },
  ],
  suggested_angles: [
    { kind: "interest", value: "Fitness & Yoga", strength: "strong" },
    { kind: "age", value: "25-34", strength: "strong" },
    { kind: "gender", value: "female", strength: "medium" },
  ],
  mapped_valid_categories: ["Outdoor & Nature", "Travel"],
};

test("resolveSingleAthleteInterestSelection uses auto-confirmed pitch angles and interests", () => {
  const auto = resolveAutoConfirmedPitchSelection(strongCuration);
  const resolved = resolveSingleAthleteInterestSelection(strongCuration);

  assert.deepEqual(resolved.interest_names, auto.interestNames);
  assert.ok(resolved.pitch_angles.some((angle) => angle.kind === "age"));
  assert.ok(resolved.pitch_angles.some((angle) => angle.kind === "gender"));
});

test("resolveSingleAthleteInterestSelection falls back to suggested_interests", () => {
  const resolved = resolveSingleAthleteInterestSelection({
    suggested_interests: strongCuration.suggested_interests,
    suggested_angles: [],
    mapped_valid_categories: strongCuration.mapped_valid_categories,
  });

  assert.deepEqual(resolved.interest_names, ["Electronics & Computers", "Sports"]);
  assert.equal(resolved.pitch_angles.length, 2);
  assert.ok(resolved.pitch_angles.every((angle) => angle.kind === "interest"));
});

test("resolveSingleAthleteInterestSelection falls back to mapped_valid_categories", () => {
  const resolved = resolveSingleAthleteInterestSelection({
    suggested_interests: [],
    suggested_angles: [],
    mapped_valid_categories: ["Outdoor & Nature", "Travel", "Music"],
  });

  assert.deepEqual(resolved.interest_names, ["Outdoor & Nature", "Travel", "Music"]);
  assert.equal(resolved.pitch_angles.length, 0);
});

test("resolveSingleAthleteInterestSelection caps mapped_valid_categories at three", () => {
  const resolved = resolveSingleAthleteInterestSelection({
    suggested_interests: [],
    suggested_angles: [],
    mapped_valid_categories: ["A", "B", "C", "D", "E"],
  });

  assert.deepEqual(resolved.interest_names, ["A", "B", "C"]);
});

test("auto-confirmed selection keeps interest and angle dimensions aligned for composePitchEmail", () => {
  const resolved = resolveSingleAthleteInterestSelection(strongCuration);
  const auto = resolveAutoConfirmedPitchSelection(strongCuration);

  assert.ok(resolved.interest_names.length > 0);
  assert.ok(resolved.pitch_angles.length >= auto.pitchAngles.length);
  for (const interest of auto.interestNames) {
    assert.ok(resolved.interest_names.includes(interest));
  }
});

test("resolveSingleAthleteInterestSelection uses weak suggested_angles when auto-confirm has none", () => {
  const resolved = resolveSingleAthleteInterestSelection({
    suggested_interests: [],
    suggested_angles: [
      { kind: "age", value: "25-34", strength: "weak" },
      { kind: "country", value: "Australia", strength: "weak" },
    ],
    mapped_valid_categories: [],
  });

  assert.equal(resolved.interest_names.length, 0);
  assert.equal(resolved.pitch_angles.length, 2);
  assert.ok(resolved.pitch_angles.some((angle) => angle.kind === "age"));
});

test("resolveSingleAthleteInterestSelection derives interest names from non-approved interest angles", () => {
  const resolved = resolveSingleAthleteInterestSelection({
    suggested_interests: [],
    suggested_angles: [{ kind: "interest", value: "Custom Niche Interest", strength: "strong" }],
    mapped_valid_categories: [],
  });

  assert.deepEqual(resolved.interest_names, ["Custom Niche Interest"]);
});
