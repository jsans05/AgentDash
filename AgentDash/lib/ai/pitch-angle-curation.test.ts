import test from "node:test";
import assert from "node:assert/strict";
import { buildSuggestedPitchAngles } from "@/lib/ai/pitch-angle-curation";
import type { AthleteAudienceProfile } from "@/lib/athlete-data";

function sampleAudience(): AthleteAudienceProfile {
  return {
    social: null,
    brands: [
      { audience_category: "Brands", audience_name: "Nike", ig_audience_percent: 0.08, ig_audience_count: 800 },
      { audience_category: "Brands", audience_name: "Lululemon", ig_audience_percent: 0.05, ig_audience_count: 500 },
    ],
    interests: [
      { audience_category: "Interests", audience_name: "Fitness & Yoga", ig_audience_percent: 0.32, ig_audience_count: 3200 },
    ],
    gender: [
      { audience_category: "Gender", audience_name: "Female", ig_audience_percent: 0.62, ig_audience_count: 6200 },
      { audience_category: "Gender", audience_name: "Male", ig_audience_percent: 0.38, ig_audience_count: 3800 },
    ],
    age: [
      { audience_category: "Combined_Age", audience_name: "25-34", ig_audience_percent: 0.41, ig_audience_count: 4100 },
      { audience_category: "Combined_Age", audience_name: "18-24", ig_audience_percent: 0.19, ig_audience_count: 1900 },
    ],
    countries: [
      { audience_category: "Countries", audience_name: "United States", ig_audience_percent: 0.58, ig_audience_count: 5800 },
    ],
    states: [],
    cities: [],
    ethnicity: [],
  };
}

test("buildSuggestedPitchAngles includes gender and age for women's fitness brand", () => {
  const angles = buildSuggestedPitchAngles({
    audience: sampleAudience(),
    suggestedInterests: [{ interest_name: "Fitness & Yoga", athlete_pct: 32 }],
    interestStrength: "strong",
    industryKey: "fitness",
    mappedCategories: ["Fitness & Yoga", "Healthy Lifestyle"],
    companyName: "Athleta",
    targetIndustryOrCategory: "women's fitness apparel",
  });

  const kinds = new Set(angles.map((a) => a.kind));
  assert.ok(kinds.has("interest"));
  assert.ok(kinds.has("gender"));
  assert.ok(kinds.has("age"));

  const gender = angles.find((a) => a.kind === "gender");
  assert.equal(gender?.value, "female");
  assert.ok((gender?.strength === "strong" || gender?.strength === "medium"));
});

test("buildSuggestedPitchAngles keeps legacy interest suggestions when audience is missing", () => {
  const angles = buildSuggestedPitchAngles({
    audience: null,
    suggestedInterests: [
      { interest_name: "Fitness & Yoga", athlete_pct: null },
      { interest_name: "Healthy Lifestyle", athlete_pct: null },
    ],
    interestStrength: "weak",
    industryKey: "fitness",
    mappedCategories: ["Fitness & Yoga", "Healthy Lifestyle"],
    companyName: "Brand Co",
    targetIndustryOrCategory: "fitness",
  });

  assert.equal(angles.length, 2);
  assert.equal(angles.every((a) => a.kind === "interest"), true);
});

test("buildSuggestedPitchAngles caps at eight entries", () => {
  const angles = buildSuggestedPitchAngles({
    audience: sampleAudience(),
    suggestedInterests: [
      { interest_name: "Fitness & Yoga", athlete_pct: 32 },
      { interest_name: "Healthy Lifestyle", athlete_pct: 20 },
      { interest_name: "Sports", athlete_pct: 18 },
      { interest_name: "Activewear", athlete_pct: 12 },
    ],
    interestStrength: "strong",
    industryKey: "fitness",
    mappedCategories: ["Fitness & Yoga", "Healthy Lifestyle", "Sports", "Activewear"],
    companyName: "Brand Co",
    targetIndustryOrCategory: "fitness",
    maxAngles: 8,
  });

  assert.ok(angles.length <= 8);
});
