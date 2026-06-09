import type { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import {
  audiencePercentPoints,
  fmtFollowers,
  getAthleteAudienceProfile,
  type AudienceRow,
} from "@/lib/athlete-data";
import { normalizeSportForPitch } from "@/lib/ai/email-generation";
import { buildProspectingAudienceSignals } from "@/lib/ai/prospecting-signals";
import { DEFAULT_CTA, type PitchSalutation, type PitchType } from "@/lib/ai/pitch-spec";
import {
  curatePitchInterests,
  type PitchInterestCurationResult,
} from "@/lib/ai/pitch-interest-curation";
import { computeRosterAudienceSummary } from "@/lib/ai/roster-audience";
import type { AudienceFactRow, PitchAthleteFactSheet, PitchFactSheet, PitchRosterFactSheet } from "@/lib/ai/pitch-fact-sheet-types";
import {
  buildPitchNarrativeAngles,
  enrichAthleteFactSheetNarrative,
} from "@/lib/ai/pitch-narrative-angles";
import { buildAthleteBioLine } from "@/lib/ai/pitch-athlete-copy";
import { formatAthleteGender, type AthleteGender } from "@/lib/athletes/gender";

export type {
  AudienceFactRow,
  PitchAthleteFactSheet,
  PitchFactSheet,
  PitchRosterFactSheet,
} from "@/lib/ai/pitch-fact-sheet-types";
export { collectFactSheetLabels, collectFactSheetNumbers } from "@/lib/ai/pitch-fact-sheet-types";

export type PitchAthleteSpotlight = {
  athlete_id: string;
  athlete_name: string;
  athlete_sport: string;
  accolades?: string[];
};

export type BuildPitchFactSheetInput = {
  supabase: SupabaseClient;
  profile: Profile;
  pitch_type: PitchType;
  company_name: string;
  recipient_name?: string;
  interest_names: string[];
  target_industry_or_category?: string | null;
  athlete_id?: string | null;
  athlete_ids?: string[];
  spotlight_athletes?: PitchAthleteSpotlight[];
  past_partnerships?: string | null;
  company_description?: string | null;
  personal_notes?: string | null;
  sender_display_name?: string;
  salutation?: PitchSalutation;
  first_name?: string | null;
  cta?: string;
  /** When provided, skips a second curatePitchInterests() during fact-sheet build (compose already curated). */
  existingCuration?: Pick<
    PitchInterestCurationResult,
    "industry_key" | "target_industry_or_category" | "rationale"
  >;
};

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

const GEO_CAP = 15;

function toFactRows(rows: AudienceRow[], cap?: number): { rows: AudienceFactRow[]; truncated: boolean } {
  const sorted = [...rows].sort((a, b) => {
    const pctDiff = Number(b.ig_audience_percent) - Number(a.ig_audience_percent);
    if (pctDiff !== 0) return pctDiff;
    return Number(b.ig_audience_count) - Number(a.ig_audience_count);
  });
  const truncated = cap != null && sorted.length > cap;
  const slice = cap != null ? sorted.slice(0, cap) : sorted;
  return {
    truncated,
    rows: slice.map((row) => ({
      label: String(row.audience_name ?? "").trim(),
      percent: Number(audiencePercentPoints(row.ig_audience_percent).toFixed(1)),
      ig_audience_count: Math.floor(Number(row.ig_audience_count ?? 0)),
    })),
  };
}

function buildCredibilityLine(sport: string, accolades: string[], about?: string | null): string {
  return buildAthleteBioLine({ sport, accolades, about });
}

export async function loadAthleteForFactSheet(
  supabase: SupabaseClient,
  athleteId: string
): Promise<
  (PitchAthleteSpotlight & {
    city: string | null;
    state: string | null;
    country: string | null;
    about: string | null;
    gender: AthleteGender | null;
  }) | null
> {
  const { data } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, gender, accolades, about, city, state, country")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!data) return null;
  const athlete_name = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim();
  const accolades = Array.isArray(data.accolades) ? data.accolades.map((a: unknown) => String(a ?? "").trim()) : [];
  return {
    athlete_id: String(data.athlete_id),
    athlete_name,
    athlete_sport: String(data.sport ?? ""),
    accolades,
    about: data.about ? String(data.about).trim() : null,
    gender: (data.gender as AthleteGender | null) ?? null,
    city: data.city ? String(data.city) : null,
    state: data.state ? String(data.state) : null,
    country: data.country ? String(data.country) : null,
  };
}

async function buildAthleteFactSheet(
  supabase: SupabaseClient,
  athleteId: string,
  spotlight: PitchAthleteSpotlight | null,
  confirmedInterestNames: string[]
): Promise<PitchAthleteFactSheet | null> {
  const extended = (await loadAthleteForFactSheet(supabase, athleteId)) ?? null;
  if (!extended && !spotlight) return null;
  const loaded = extended ?? {
    athlete_id: athleteId,
    athlete_name: spotlight!.athlete_name,
    athlete_sport: spotlight!.athlete_sport,
    accolades: spotlight!.accolades ?? [],
    about: null,
    gender: null,
    city: null,
    state: null,
    country: null,
  };
  const profile = await getAthleteAudienceProfile(supabase, athleteId);
  const selected = new Set(confirmedInterestNames.map((n) => n.trim().toLowerCase()));

  const confirmed_interests: AudienceFactRow[] = (profile.interests ?? [])
    .filter((row) => selected.has(String(row.audience_name ?? "").trim().toLowerCase()))
    .sort((a, b) => Number(b.ig_audience_percent) - Number(a.ig_audience_percent))
    .map((row) => ({
      label: String(row.audience_name ?? "").trim(),
      percent: Number(audiencePercentPoints(row.ig_audience_percent).toFixed(1)),
      ig_audience_count: Math.floor(Number(row.ig_audience_count ?? 0)),
    }));

  const gender = toFactRows(profile.gender ?? []);
  const age = toFactRows(profile.age ?? []);
  const ethnicity = toFactRows(profile.ethnicity ?? []);
  const brands = toFactRows(profile.brands ?? [], 10);
  const countries = toFactRows(profile.countries ?? [], GEO_CAP);
  const states = toFactRows(profile.states ?? [], GEO_CAP);
  const cities = toFactRows(profile.cities ?? [], GEO_CAP);

  const signals = buildProspectingAudienceSignals(profile);
  const social = profile.social;

  return {
    athlete_id: athleteId,
    name: loaded.athlete_name,
    sport: normalizeSportForPitch(loaded.athlete_sport),
    athlete_gender: formatAthleteGender(loaded.gender ?? null),
    accolades: loaded.accolades ?? [],
    credibility_line: buildCredibilityLine(loaded.athlete_sport, loaded.accolades ?? [], loaded.about),
    about: loaded.about ?? null,
    origin: {
      city: loaded.city ?? null,
      state: loaded.state ?? null,
      country: loaded.country ?? null,
    },
    total_followers: Math.floor(Number(social?.total_followers ?? 0)),
    ig_followers: social?.ig_followers != null ? Math.floor(Number(social.ig_followers)) : null,
    tt_followers: social?.tt_followers != null ? Math.floor(Number(social.tt_followers)) : null,
    fb_followers: social?.fb_followers != null ? Math.floor(Number(social.fb_followers)) : null,
    x_followers: social?.x_followers != null ? Math.floor(Number(social.x_followers)) : null,
    avg_er_20p:
      social?.avg_er_20p != null ? Number(audiencePercentPoints(Number(social.avg_er_20p)).toFixed(2)) : null,
    confirmed_interests,
    gender: gender.rows,
    age: age.rows,
    ethnicity: ethnicity.rows,
    brand_affinities: brands.rows.map((r) => ({ ...r, label: r.label })),
    audience_countries: countries.rows,
    audience_states: states.rows,
    audience_cities: cities.rows,
    geo_truncated: {
      countries: countries.truncated,
      states: states.truncated,
      cities: cities.truncated,
    },
    inference_hints: signals.demographicInferences,
  };
}

export async function buildPitchFactSheet(
  input: BuildPitchFactSheetInput,
  effectiveInterests: string[],
  curationRationale?: string
): Promise<PitchFactSheet> {
  const company_name = String(input.company_name ?? "").trim();
  const cta = String(input.cta ?? "").trim() || DEFAULT_CTA;
  const recipient_name = String(input.recipient_name ?? "").trim() || "[Recipient Name]";

  const athleteIds = (
    input.athlete_ids?.length
      ? input.athlete_ids
      : input.athlete_id
        ? [input.athlete_id]
        : input.spotlight_athletes?.map((a) => a.athlete_id) ?? []
  )
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  const athletes: PitchAthleteFactSheet[] = [];
  for (const aid of athleteIds) {
    const spotlight = input.spotlight_athletes?.find((a) => a.athlete_id === aid) ?? null;
    const fact = await buildAthleteFactSheet(input.supabase, aid, spotlight, effectiveInterests);
    if (fact) athletes.push(fact);
  }

  if (athletes.length === 0 && input.athlete_id) {
    const fact = await buildAthleteFactSheet(
      input.supabase,
      input.athlete_id,
      input.spotlight_athletes?.[0] ?? null,
      effectiveInterests
    );
    if (fact) athletes.push(fact);
  }

  const curation =
    input.existingCuration ??
    (await curatePitchInterests({
      supabase: input.supabase,
      profile: input.profile,
      pitch_type: input.pitch_type,
      company_name,
      target_industry_or_category: input.target_industry_or_category,
      athlete_id: athleteIds[0] ?? input.athlete_id ?? null,
      max_suggestions: 5,
    }));

  const industryKey = curation.industry_key;
  const personalNotes = input.personal_notes?.trim() || null;
  const enrichedAthletes = athletes.map((a) =>
    enrichAthleteFactSheetNarrative(a, company_name, industryKey, effectiveInterests, personalNotes)
  );
  const pitch_angles = buildPitchNarrativeAngles({
    athletes: enrichedAthletes,
    companyName: company_name,
    industryKey,
    confirmedInterests: effectiveInterests,
  });

  const EMAIL_STRUCTURE = `1) Hi + Hope you are well, and nice to meet you! 2) Optional I recently noticed… ONLY if past_partnerships is set. 3) I'm [sender] with The·Team, reaching out on behalf of [name], [athlete_bio_line]. 4) partnership_intent_line. 5) audience_stats_narrative + optional authentic_use_line. Never lecture the brand on their products.`;

  let roster: PitchRosterFactSheet | undefined;
  if (input.pitch_type === "roster_aggregate" || input.pitch_type === "roster_athlete_led") {
    const summary = await computeRosterAudienceSummary(input.supabase, input.profile, effectiveInterests);
    roster = {
      roster_total_athletes: summary.roster_total_athletes,
      total_audience_display: summary.total_audience_display,
      interest_breakdown: (summary.interest_breakdown ?? []).map((row) => ({
        interest_name: row.interest_name,
        athlete_count: row.athlete_count,
        total_ig_audience_count: row.total_ig_audience_count,
      })),
    };
  }

  return {
    recipient_name,
    first_name: input.first_name ?? null,
    salutation_style: input.salutation === "hey_first_name" ? "hey_first_name" : "hi_placeholder",
    sender_display_name: String(input.sender_display_name ?? "").trim() || "[User Name]",
    company_name,
    industry_key: curation.industry_key,
    target_category: curation.target_industry_or_category,
    past_partnerships: input.past_partnerships?.trim() || null,
    company_description: input.company_description?.trim() || null,
    personal_notes: input.personal_notes?.trim() || null,
    pitch_type: input.pitch_type,
    voice: "agent_led",
    cta,
    confirmed_interest_names: effectiveInterests,
    athletes: enrichedAthletes,
    roster,
    curation_rationale: curationRationale ?? curation.rationale,
    pitch_angles,
    category_fit_line: enrichedAthletes[0]?.partnership_intent_line ?? null,
    email_structure: EMAIL_STRUCTURE,
  };
}

/** Human-readable follower scale for polisher prompts. */
export function formatTotalFollowersDisplay(total: number): string {
  return fmtFollowers(total > 0 ? total : null);
}
