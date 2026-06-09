import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAthleteOriginStory,
  buildBrandRelevanceLine,
  buildPitchNarrativeAngles,
  computeAthleteAgeRollup,
} from "@/lib/ai/pitch-narrative-angles";
import type { PitchAthleteFactSheet } from "@/lib/ai/pitch-fact-sheet-types";

function sampleAthlete(overrides: Partial<PitchAthleteFactSheet> = {}): PitchAthleteFactSheet {
  return {
    athlete_id: "a1",
    name: "Jett Lawrence",
    sport: "motocross",
    accolades: [],
    credibility_line: "motocross athlete",
    origin: { city: null, state: null, country: "Australia" },
    total_followers: 1_310_911,
    ig_followers: 900_000,
    tt_followers: null,
    fb_followers: null,
    x_followers: null,
    avg_er_20p: null,
    confirmed_interests: [
      { label: "Electronics & Computers", percent: 10.7, ig_audience_count: 95055 },
    ],
    gender: [],
    age: [
      { label: "25-34", percent: 39.3, ig_audience_count: 349188 },
      { label: "18-24", percent: 34.1, ig_audience_count: 303341 },
    ],
    ethnicity: [],
    brand_affinities: [],
    audience_countries: [],
    audience_states: [],
    audience_cities: [],
    inference_hints: ["Audience age centers around young-to-mid adults."],
    ...overrides,
  };
}

test("computeAthleteAgeRollup sums 18-34 bands", () => {
  const rollup = computeAthleteAgeRollup(sampleAthlete().age);
  assert.equal(rollup.age_18_34_pct, 73.4);
  assert.equal(rollup.age_18_34_follower_count, 652529);
});

test("buildAthleteOriginStory returns null (no generic market boilerplate)", () => {
  const story = buildAthleteOriginStory(
    [sampleAthlete(), sampleAthlete({ name: "Hunter Lawrence", athlete_id: "a2" })],
    "Boost Mobile"
  );
  assert.equal(story, null);
});

test("buildPitchNarrativeAngles uses enriched athlete fields when present", () => {
  const angles = buildPitchNarrativeAngles({
    athletes: [
      sampleAthlete({
        partnership_intent_line: "Jett is looking for a consumer tech partner.",
        audience_stats_narrative:
          "Across his following of 1,310,911, 10.7% (95,055) are interested in electronics and computers, and his audience is made up of 73.4% in the 18–34 range.",
      }),
    ],
    companyName: "Boost Mobile",
    industryKey: "tech",
    confirmedInterests: ["Electronics & Computers"],
  });
  assert.ok(angles.some((a) => /18–34|18-34/.test(a)));
});

test("buildPitchNarrativeAngles includes partnership and stats hooks", () => {
  const angles = buildPitchNarrativeAngles({
    athletes: [
      sampleAthlete({
        athlete_bio_line: "World Surf League Championship Tour competitor",
        partnership_intent_line:
          "Crosby is looking for a camera and imaging partner to support his surf content production.",
        audience_stats_narrative:
          "Across his following of 101,828, 36.2% (36,800) are interested in cameras and photography.",
        authentic_use_line: "through authentic use capturing premium content in the surf.",
      }),
    ],
    companyName: "DJI",
    industryKey: "tech",
    confirmedInterests: ["Camera & Photography"],
  });
  assert.ok(angles.some((a) => /looking for a camera/i.test(a)));
  assert.ok(angles.some((a) => /101,828/.test(a)));
  assert.ok(angles.every((a) => !/DJI sells/i.test(a)));
});
