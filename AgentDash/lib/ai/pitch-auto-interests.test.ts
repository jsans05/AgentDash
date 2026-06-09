import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAutoConfirmedInterests,
  shouldAutoConfirmPitchInterests,
} from "@/lib/ai/pitch-auto-interests";
import type { PitchInterestCurationResult } from "@/lib/ai/pitch-interest-curation";

const strongCuration: Pick<
  PitchInterestCurationResult,
  "interest_strength" | "suggested_interests"
> = {
  interest_strength: "strong",
  suggested_interests: [
    { interest_name: "Electronics & Computers", athlete_pct: 10, roster_audience_count: null, roster_athlete_count: null },
    { interest_name: "Sports", athlete_pct: 8, roster_audience_count: null, roster_athlete_count: null },
  ],
};

test("shouldAutoConfirmPitchInterests in CRM when strong", () => {
  assert.equal(shouldAutoConfirmPitchInterests(strongCuration, { pipelineDrafting: true }), true);
  assert.equal(shouldAutoConfirmPitchInterests(strongCuration, { pipelineDrafting: false }), false);
});

test("resolveAutoConfirmedInterests returns up to three canonical interests", () => {
  const picks = resolveAutoConfirmedInterests(strongCuration);
  assert.deepEqual(picks, ["Electronics & Computers", "Sports"]);
});
