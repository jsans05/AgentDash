import type { EmailTemplateMode } from "@/lib/ai/email-generation";

/** Canonical pitch types — product-facing email modes. */
export type PitchType =
  | "roster_aggregate"
  | "roster_athlete_led"
  | "single_athlete"
  | "multi_athlete_per_contact"
  | "multi_athlete_combined";

export type PitchSalutation = "hi_placeholder" | "hey_first_name";

export type PitchBlock =
  | "past_partnerships"
  | "team_intro"
  | "roster_stats"
  | "athlete_spotlight"
  | "audience_proof"
  | "fit_bridge"
  | "cta"
  | "closing";

export type PitchSpec = {
  pitchType: PitchType;
  maxWords: number;
  salutation: PitchSalutation;
  blocks: PitchBlock[];
  templateMode: EmailTemplateMode;
};

export const GLOBAL_EMAIL_CLOSING = "Looking forward to hearing from you,";

export const STANDARD_TEAM_INTRO =
  "At The·Team, we represent the top action and adventure sports athletes, Olympians, and properties. Our roster spans the top athletes across Motocross, Surfing, Snow, Climbing, and more.";

export const STANDARD_TEAM_INTRO_FIRST_PERSON_PREFIX =
  "I'm {{sender_name}} at The·Team, we represent the top action and adventure sports athletes, Olympians, and properties. Our roster spans the top athletes across Motocross, Surfing, Snow, Climbing, and more.";

export const PLEASURE_LINE = "Hope you are well and pleasure to meet you by email.";

export const DEFAULT_CTA =
  "If interested, I can share more to outline this opportunity.";

const PITCH_SPECS: Record<PitchType, PitchSpec> = {
  roster_aggregate: {
    pitchType: "roster_aggregate",
    maxWords: 200,
    salutation: "hi_placeholder",
    blocks: ["past_partnerships", "team_intro", "roster_stats", "cta", "closing"],
    templateMode: "general_high_level",
  },
  roster_athlete_led: {
    pitchType: "roster_athlete_led",
    maxWords: 240,
    salutation: "hi_placeholder",
    blocks: [
      "past_partnerships",
      "team_intro",
      "athlete_spotlight",
      "roster_stats",
      "audience_proof",
      "cta",
      "closing",
    ],
    templateMode: "general_athlete_led",
  },
  single_athlete: {
    pitchType: "single_athlete",
    maxWords: 220,
    salutation: "hi_placeholder",
    blocks: ["past_partnerships", "team_intro", "athlete_spotlight", "audience_proof", "cta", "closing"],
    templateMode: "one_to_one",
  },
  multi_athlete_per_contact: {
    pitchType: "multi_athlete_per_contact",
    maxWords: 220,
    salutation: "hi_placeholder",
    blocks: ["past_partnerships", "team_intro", "athlete_spotlight", "audience_proof", "cta", "closing"],
    templateMode: "one_to_one",
  },
  multi_athlete_combined: {
    pitchType: "multi_athlete_combined",
    maxWords: 320,
    salutation: "hi_placeholder",
    blocks: ["past_partnerships", "team_intro", "athlete_spotlight", "audience_proof", "cta", "closing"],
    templateMode: "multi_athlete",
  },
};

export function getPitchSpec(pitchType: PitchType): PitchSpec {
  return PITCH_SPECS[pitchType];
}

export function pitchTypeToFlowLabel(pitchType: PitchType): string {
  switch (pitchType) {
    case "roster_aggregate":
      return "roster aggregate (full roster audience)";
    case "roster_athlete_led":
      return "roster + athlete spotlight";
    case "single_athlete":
      return "single athlete";
    case "multi_athlete_per_contact":
      return "multiple athletes (one email each)";
    case "multi_athlete_combined":
      return "multiple athletes (one combined email)";
    default:
      return pitchType;
  }
}

export function countWords(text: string): number {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function validatePitchBodyWordLimit(body: string, maxWords: number): { ok: boolean; wordCount: number } {
  const wordCount = countWords(body);
  return { ok: wordCount <= maxWords, wordCount };
}
