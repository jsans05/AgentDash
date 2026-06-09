import test from "node:test";
import assert from "node:assert/strict";
import { validatePolishedPitchEmail } from "@/lib/ai/pitch-email-polish-validation";
import { GLOBAL_EMAIL_CLOSING } from "@/lib/ai/pitch-spec";
import type { PitchFactSheet } from "@/lib/ai/pitch-fact-sheet-types";

const baseSheet: PitchFactSheet = {
  recipient_name: "Kelly",
  first_name: null,
  salutation_style: "hi_placeholder",
  sender_display_name: "John Sanseverino",
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
      origin: { city: null, state: null, country: "USA" },
      total_followers: 2_500_000,
      ig_followers: null,
      tt_followers: null,
      fb_followers: null,
      x_followers: null,
      avg_er_20p: null,
      confirmed_interests: [{ label: "Electronics & Computers", percent: 32.7, ig_audience_count: 95055 }],
      gender: [{ label: "Female", percent: 77, ig_audience_count: 100 }],
      age: [{ label: "25-34", percent: 68, ig_audience_count: 200 }],
      ethnicity: [],
      brand_affinities: [],
      audience_countries: [],
      audience_states: [],
      audience_cities: [],
      inference_hints: [],
    },
  ],
};

test("validatePolishedPitchEmail rejects invented percentage", () => {
  const body = `Hi Kelly,\n\n32.7% interested in Electronics.\n\n99% fake stat.\n\n${GLOBAL_EMAIL_CLOSING}`;
  const result = validatePolishedPitchEmail("Subj", body, baseSheet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("99%")));
});

test("validatePolishedPitchEmail accepts sheet-matching prose", () => {
  const body = `Hi Kelly,\n\nHope you are well.\n\n32.7% of the audience is interested in Electronics & Computers with 2,500,000 followers and 77% Female.\n\nIf interested, I can share more.\n\n${GLOBAL_EMAIL_CLOSING}`;
  const result = validatePolishedPitchEmail("Jett x Boost", body, baseSheet);
  assert.equal(result.ok, true);
});
