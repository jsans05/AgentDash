import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAthleteBioLine,
  buildAudienceStatsNarrative,
  buildPartnershipIntentLine,
} from "@/lib/ai/pitch-athlete-copy";
import type { PitchAthleteFactSheet } from "@/lib/ai/pitch-fact-sheet-types";

test("buildAthleteBioLine prefers accolades when present", () => {
  const bio = buildAthleteBioLine({
    sport: "surf",
    accolades: ["World Surf League Championship Tour competitor", "2024 CT #12"],
    about: null,
  });
  assert.match(bio, /World Surf League/);
});

test("buildAthleteBioLine returns empty when no about or accolades", () => {
  const bio = buildAthleteBioLine({ sport: "surf", accolades: [], about: null });
  assert.equal(bio, "");
});

test("buildPartnershipIntentLine frames athlete-side camera partner seek", () => {
  const line = buildPartnershipIntentLine({
    athleteName: "Crosby Colapinto",
    sport: "surf",
    confirmedInterests: ["Camera & Photography"],
  });
  assert.match(line ?? "", /looking for a camera/i);
  assert.doesNotMatch(line ?? "", /DJI sells/i);
});

test("buildAudienceStatsNarrative weaves followers interest and age", () => {
  const athlete: PitchAthleteFactSheet = {
    athlete_id: "a1",
    name: "Crosby Colapinto",
    sport: "surf",
    accolades: [],
    credibility_line: "",
    origin: { city: null, state: null, country: "USA" },
    total_followers: 101_828,
    ig_followers: null,
    tt_followers: null,
    fb_followers: null,
    x_followers: null,
    avg_er_20p: null,
    confirmed_interests: [
      { label: "Camera & Photography", percent: 36.2, ig_audience_count: 36800 },
    ],
    gender: [],
    age: [
      { label: "25-34", percent: 33.8, ig_audience_count: 34000 },
      { label: "18-24", percent: 19.8, ig_audience_count: 20000 },
    ],
    ethnicity: [],
    brand_affinities: [],
    audience_countries: [],
    audience_states: [],
    audience_cities: [],
    inference_hints: [],
    age_18_34_pct: 53.6,
  };
  const narrative = buildAudienceStatsNarrative(athlete);
  assert.match(narrative ?? "", /101,828/);
  assert.match(narrative ?? "", /36\.2%/);
  assert.match(narrative ?? "", /cameras and photography/i);
  assert.match(narrative ?? "", /18–34|18-34/);
  assert.match(narrative ?? "", /early adopters/i);
});
