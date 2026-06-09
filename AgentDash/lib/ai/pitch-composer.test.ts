import test from "node:test";
import assert from "node:assert/strict";
import { getPitchSpec, countWords, GLOBAL_EMAIL_CLOSING } from "@/lib/ai/pitch-spec";
import { formatRosterAudienceCountDisplay } from "@/lib/ai/roster-audience";

test("getPitchSpec returns closing block for single athlete", () => {
  const spec = getPitchSpec("single_athlete");
  assert.ok(spec.blocks.includes("closing"));
  assert.equal(spec.maxWords, 220);
});

test("formatRosterAudienceCountDisplay formats large counts", () => {
  assert.equal(formatRosterAudienceCountDisplay(1_500_000), "1.5 million");
  assert.ok(formatRosterAudienceCountDisplay(42_000).includes("42"));
});

test("countWords ignores extra whitespace", () => {
  assert.equal(countWords("  one   two  three  "), 3);
});

test("global closing constant is stable", () => {
  assert.equal(GLOBAL_EMAIL_CLOSING, "Looking forward to hearing from you,");
});

test("multi_athlete_combined pitch spec allows longer combined body", () => {
  const spec = getPitchSpec("multi_athlete_combined");
  assert.equal(spec.pitchType, "multi_athlete_combined");
  assert.ok(spec.maxWords >= 300);
  assert.ok(spec.blocks.includes("closing"));
});
