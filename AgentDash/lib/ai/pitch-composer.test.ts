import test from "node:test";
import assert from "node:assert/strict";
import { getPitchSpec, countWords, GLOBAL_EMAIL_CLOSING } from "@/lib/ai/pitch-spec";
import { formatRosterAudienceCountDisplay } from "@/lib/ai/roster-audience";
import { athletePitchAngleInsightLines } from "@/lib/ai/pitch-angle-bullets";
import type { AthleteAudienceProfile } from "@/lib/athlete-data";

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

test("athletePitchAngleInsightLines renders age and country bullets sorted by percent", () => {
  const profile: AthleteAudienceProfile = {
    social: null,
    brands: [],
    interests: [],
    gender: [],
    age: [
      { audience_category: "Combined_Age", audience_name: "25-34", ig_audience_percent: 0.42, ig_audience_count: 4200 },
      { audience_category: "Combined_Age", audience_name: "18-24", ig_audience_percent: 0.18, ig_audience_count: 1800 },
    ],
    countries: [
      { audience_category: "Countries", audience_name: "Australia", ig_audience_percent: 0.31, ig_audience_count: 3100 },
    ],
    states: [],
    cities: [],
    ethnicity: [],
  };

  const lines = athletePitchAngleInsightLines(
    profile,
    [
      { kind: "country", name: "Australia" },
      { kind: "age", cohort: "25-34" },
    ],
    "Jane Doe"
  );

  assert.equal(lines.length, 2);
  assert.match(lines[0], /42\.0% of Jane Doe's audience is aged 25-34/);
  assert.match(lines[1], /31\.0% of Jane Doe's audience is in Australia/);
});

test("athletePitchAngleInsightLines skips missing angles without error", () => {
  const profile: AthleteAudienceProfile = {
    social: null,
    brands: [],
    interests: [],
    gender: [],
    age: [],
    countries: [],
    states: [],
    cities: [],
    ethnicity: [],
  };

  const lines = athletePitchAngleInsightLines(
    profile,
    [{ kind: "age", cohort: "55-64" }],
    "Jane Doe"
  );

  assert.deepEqual(lines, []);
});
