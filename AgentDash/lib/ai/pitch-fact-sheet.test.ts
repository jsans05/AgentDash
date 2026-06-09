import test from "node:test";
import assert from "node:assert/strict";
import {
  collectFactSheetNumbers,
  collectFactSheetLabels,
  type PitchFactSheet,
} from "@/lib/ai/pitch-fact-sheet-types";

test("collectFactSheetNumbers gathers athlete and demographic stats", () => {
  const sheet: PitchFactSheet = {
    recipient_name: "Hi",
    first_name: null,
    salutation_style: "hi_placeholder",
    sender_display_name: "John",
    company_name: "Boost Mobile",
    industry_key: "tech",
    target_category: null,
    past_partnerships: null,
    company_description: null,
    personal_notes: null,
    pitch_type: "single_athlete",
    voice: "agent_led",
    cta: "If interested, I can share more to outline this opportunity.",
    confirmed_interest_names: ["Electronics & Computers"],
    athletes: [
      {
        athlete_id: "a1",
        name: "Jett Lawrence",
        sport: "motocross",
        accolades: [],
        credibility_line: "leading motocross athlete",
        origin: { city: null, state: null, country: "Australia" },
        age: [
          { label: "25-34", percent: 39.3, ig_audience_count: 349188 },
          { label: "18-24", percent: 34.1, ig_audience_count: 303341 },
        ],
        total_followers: 2_500_000,
        ig_followers: 900_000,
        tt_followers: null,
        fb_followers: null,
        x_followers: null,
        avg_er_20p: null,
        confirmed_interests: [{ label: "Electronics & Computers", percent: 10.7, ig_audience_count: 95055 }],
        gender: [{ label: "Male", percent: 60, ig_audience_count: 100 }],
        ethnicity: [],
        brand_affinities: [{ label: "Nike", percent: 5, ig_audience_count: 1000 }],
        audience_countries: [{ label: "United States", percent: 80, ig_audience_count: 500000 }],
        audience_states: [],
        audience_cities: [],
        inference_hints: [],
      },
    ],
  };
  const nums = collectFactSheetNumbers(sheet);
  assert.ok(nums.includes(2_500_000));
  assert.ok(nums.includes(10.7));
  const labels = collectFactSheetLabels(sheet);
  assert.ok(labels.some((l) => l.includes("Electronics")));
  assert.ok(labels.includes("Australia"));
});
