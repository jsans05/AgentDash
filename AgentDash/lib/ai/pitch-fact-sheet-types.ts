import type { PitchSalutation, PitchType } from "@/lib/ai/pitch-spec";

export type AudienceFactRow = {
  label: string;
  percent: number;
  ig_audience_count: number;
};

export type PitchAthleteFactSheet = {
  athlete_id: string;
  name: string;
  sport: string;
  /** Roster basic info — athlete's own gender (not IG audience gender split). */
  athlete_gender: string | null;
  accolades: string[];
  credibility_line: string;
  origin: { city: string | null; state: string | null; country: string | null };
  total_followers: number;
  ig_followers: number | null;
  tt_followers: number | null;
  fb_followers: number | null;
  x_followers: number | null;
  avg_er_20p: number | null;
  confirmed_interests: AudienceFactRow[];
  gender: AudienceFactRow[];
  age: AudienceFactRow[];
  ethnicity: AudienceFactRow[];
  brand_affinities: AudienceFactRow[];
  audience_countries: AudienceFactRow[];
  audience_states: AudienceFactRow[];
  audience_cities: AudienceFactRow[];
  geo_truncated?: { countries?: boolean; states?: boolean; cities?: boolean };
  inference_hints: string[];
  about?: string | null;
  athlete_bio_line?: string;
  partnership_intent_line?: string | null;
  audience_stats_narrative?: string | null;
  authentic_use_line?: string | null;
  age_18_34_pct?: number | null;
  age_18_34_follower_count?: number | null;
  top_age_band_lines?: string[];
  origin_story?: string | null;
  category_fit_line?: string | null;
};

export type PitchRosterFactSheet = {
  roster_total_athletes: number;
  total_audience_display: string;
  interest_breakdown: Array<{
    interest_name: string;
    athlete_count: number;
    total_ig_audience_count: number;
  }>;
};

export type PitchFactSheet = {
  recipient_name: string;
  first_name: string | null;
  salutation_style: PitchSalutation;
  sender_display_name: string;
  company_name: string;
  industry_key: string | null;
  target_category: string | null;
  past_partnerships: string | null;
  company_description: string | null;
  personal_notes: string | null;
  pitch_type: PitchType;
  voice: "agent_led";
  cta: string;
  confirmed_interest_names: string[];
  athletes: PitchAthleteFactSheet[];
  roster?: PitchRosterFactSheet;
  curation_rationale?: string;
  pitch_angles?: string[];
  /** @deprecated Use partnership_intent_line on athlete — kept for validation compatibility */
  category_fit_line?: string | null;
  email_structure?: string;
};

export function collectFactSheetNumbers(sheet: PitchFactSheet): number[] {
  const nums: number[] = [];
  const push = (n: number) => {
    if (Number.isFinite(n)) nums.push(n);
  };
  for (const a of sheet.athletes) {
    push(a.total_followers);
    if (a.ig_followers != null) push(a.ig_followers);
    if (a.tt_followers != null) push(a.tt_followers);
    if (a.fb_followers != null) push(a.fb_followers);
    if (a.x_followers != null) push(a.x_followers);
    if (a.avg_er_20p != null) push(a.avg_er_20p);
    if (a.age_18_34_pct != null) push(a.age_18_34_pct);
    if (a.age_18_34_follower_count != null) push(a.age_18_34_follower_count);
    for (const block of [
      a.confirmed_interests,
      a.gender,
      a.age,
      a.ethnicity,
      a.brand_affinities,
      a.audience_countries,
      a.audience_states,
      a.audience_cities,
    ]) {
      for (const row of block) {
        push(row.percent);
        push(row.ig_audience_count);
      }
    }
  }
  if (sheet.roster) {
    for (const row of sheet.roster.interest_breakdown) {
      push(row.athlete_count);
      push(row.total_ig_audience_count);
    }
  }
  return nums;
}

export function collectFactSheetLabels(sheet: PitchFactSheet): string[] {
  const labels: string[] = [...sheet.confirmed_interest_names];
  for (const a of sheet.athletes) {
    for (const block of [
      a.confirmed_interests,
      a.gender,
      a.age,
      a.ethnicity,
      a.brand_affinities,
      a.audience_countries,
      a.audience_states,
      a.audience_cities,
    ]) {
      for (const row of block) labels.push(row.label);
    }
    if (a.origin.country) labels.push(a.origin.country);
    if (a.origin.state) labels.push(a.origin.state);
    if (a.origin.city) labels.push(a.origin.city);
  }
  return labels.filter(Boolean);
}
