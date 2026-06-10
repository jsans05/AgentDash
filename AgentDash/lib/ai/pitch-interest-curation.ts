import type { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { getRelevantAudienceInterests } from "@/lib/ai/getRelevantAudienceInterests";
import { getInterestCategoriesForBrandType, type IndustryInterestKey } from "@/lib/industry-interest-map";
import type { PitchType } from "@/lib/ai/pitch-spec";
import {
  computeRosterAudienceSummary,
  getRosterAthleteIdsForProfile,
  rankMappedInterestsOnRoster,
} from "@/lib/ai/roster-audience";
import { buildSuggestedPitchAngles, type SuggestedPitchAngle } from "@/lib/ai/pitch-angle-curation";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export type CuratedDemographicLine = {
  category: "age" | "country";
  label: string;
  display: string;
};

export type CuratedInterestSuggestion = {
  interest_name: string;
  /** Athlete % when scope is single athlete; null for roster-only ranking */
  athlete_pct: number | null;
  /** Roster aggregate count when scope includes roster */
  roster_audience_count: number | null;
  roster_athlete_count: number | null;
};

export type PitchInterestCurationResult = {
  pitch_type: PitchType;
  company_name: string;
  target_industry_or_category: string | null;
  industry_key: string | null;
  mapped_valid_categories: string[];
  suggested_interests: CuratedInterestSuggestion[];
  suggested_angles: SuggestedPitchAngle[];
  suggested_demographics: CuratedDemographicLine[];
  interest_strength: "strong" | "weak" | "unknown";
  rationale: string;
};

function interestStrengthLabel(maxPct: number | null): "strong" | "weak" | "unknown" {
  if (maxPct == null) return "unknown";
  return maxPct >= 6 ? "strong" : "weak";
}

function attachSuggestedAngles(
  result: Omit<PitchInterestCurationResult, "suggested_angles"> & { suggested_angles?: SuggestedPitchAngle[] },
  audience: Awaited<ReturnType<typeof getAthleteAudienceProfile>> | null
): PitchInterestCurationResult {
  const suggested_angles =
    result.suggested_angles ??
    buildSuggestedPitchAngles({
      audience,
      suggestedInterests: result.suggested_interests,
      interestStrength: result.interest_strength,
      industryKey: (result.industry_key as IndustryInterestKey | null) ?? null,
      mappedCategories: result.mapped_valid_categories,
      companyName: result.company_name,
      targetIndustryOrCategory: result.target_industry_or_category,
    });
  return { ...result, suggested_angles };
}

function buildRationale(params: {
  companyName: string;
  industryKey: string | null;
  suggested: CuratedInterestSuggestion[];
  strength: "strong" | "weak" | "unknown";
  scope: "roster" | "athlete";
}): string {
  const names = params.suggested.map((s) => s.interest_name).join(", ");
  if (!names) {
    return params.industryKey
      ? `No roster-scale signal yet for mapped interests pitching ${params.companyName}; confirm categories manually.`
      : `Could not map ${params.companyName} to a sponsorship category — pick interests that fit the brand.`;
  }
  const scopeNote = params.scope === "roster" ? "roster audience scale" : "athlete audience fit";
  return `Suggested for ${params.companyName} based on ${scopeNote} and brand category mapping (${params.strength} alignment): ${names}.`;
}

export async function curatePitchInterests(params: {
  supabase: SupabaseClient;
  profile: Profile;
  pitch_type: PitchType;
  company_name: string;
  target_industry_or_category?: string | null;
  athlete_id?: string | null;
  max_suggestions?: number;
}): Promise<PitchInterestCurationResult> {
  const company_name = String(params.company_name ?? "").trim();
  const pitch_type = params.pitch_type;
  const maxSuggestions = Math.max(1, Math.min(params.max_suggestions ?? 5, 8));
  const target =
    String(params.target_industry_or_category ?? "").trim() ||
    null;

  const { industryKey, interests: mappedCategories } = getInterestCategoriesForBrandType(target);

  const needsRosterRanking =
    pitch_type === "roster_aggregate" || pitch_type === "roster_athlete_led";

  const athleteId = String(params.athlete_id ?? "").trim() || null;

  if (needsRosterRanking && mappedCategories.length > 0) {
    const ranked = await rankMappedInterestsOnRoster(
      params.supabase,
      params.profile,
      mappedCategories,
      Math.max(maxSuggestions, mappedCategories.length)
    );

    const topMapped = mappedCategories.slice(0, maxSuggestions);
    const rankedNames = new Set(ranked.map((r) => r.interest_name));
    const fillFromMap = topMapped.filter((n) => !rankedNames.has(n)).slice(0, maxSuggestions - ranked.length);
    const orderedNames = [
      ...ranked.map((r) => r.interest_name),
      ...fillFromMap,
    ].slice(0, maxSuggestions);

    const summary =
      orderedNames.length > 0
        ? await computeRosterAudienceSummary(params.supabase, params.profile, orderedNames)
        : null;

    const suggested_interests: CuratedInterestSuggestion[] = orderedNames.map((interest_name) => {
      const row = summary?.interest_breakdown.find((b) => b.interest_name === interest_name);
      return {
        interest_name,
        athlete_pct: null,
        roster_audience_count: row?.total_ig_audience_count ?? 0,
        roster_athlete_count: row?.athlete_count ?? 0,
      };
    });

    const maxRoster = suggested_interests.reduce(
      (m, s) => Math.max(m, s.roster_audience_count ?? 0),
      0
    );
    const strength =
      maxRoster > 0 ? "strong" : mappedCategories.length > 0 ? "weak" : "unknown";

    return attachSuggestedAngles(
      {
        pitch_type,
        company_name,
        target_industry_or_category: target,
        industry_key: industryKey,
        mapped_valid_categories: mappedCategories,
        suggested_interests,
        suggested_demographics: [],
        interest_strength: strength,
        rationale: buildRationale({
          companyName: company_name,
          industryKey,
          suggested: suggested_interests,
          strength,
          scope: "roster",
        }),
      },
      null
    );
  }

  if (
    athleteId &&
    (pitch_type === "single_athlete" ||
      pitch_type === "multi_athlete_per_contact" ||
      pitch_type === "multi_athlete_combined")
  ) {
    const audience = await getAthleteAudienceProfile(params.supabase, athleteId);
    const interestItems = (audience.interests ?? []).map((i) => ({
      name: i.audience_name,
      value: Number(audiencePercentPoints(i.ig_audience_percent).toFixed(1)),
    }));

    const relevant = getRelevantAudienceInterests(target, interestItems, {
      maxUsedInterests: maxSuggestions,
    });

    const suggested_interests: CuratedInterestSuggestion[] = relevant.usedInterests.map((u) => ({
      interest_name: u.name,
      athlete_pct: u.value,
      roster_audience_count: null,
      roster_athlete_count: null,
    }));

    if (suggested_interests.length < maxSuggestions && mappedCategories.length > 0) {
      const have = new Set(suggested_interests.map((s) => s.interest_name));
      for (const name of mappedCategories) {
        if (suggested_interests.length >= maxSuggestions) break;
        if (have.has(name)) continue;
        suggested_interests.push({
          interest_name: name,
          athlete_pct: null,
          roster_audience_count: null,
          roster_athlete_count: null,
        });
        have.add(name);
      }
    }

    const strength = interestStrengthLabel(relevant.interestStrength.maxInterestPct);

    const suggested_demographics: CuratedDemographicLine[] = [];
    for (const a of (audience.age ?? []).slice(0, 2)) {
      suggested_demographics.push({
        category: "age",
        label: a.audience_name,
        display: `${a.audience_name}: ${audiencePercentPoints(a.ig_audience_percent).toFixed(1)}%`,
      });
    }
    for (const c of (audience.countries ?? []).slice(0, 2)) {
      suggested_demographics.push({
        category: "country",
        label: c.audience_name,
        display: `${c.audience_name}: ${audiencePercentPoints(c.ig_audience_percent).toFixed(1)}%`,
      });
    }

    return attachSuggestedAngles(
      {
        pitch_type,
        company_name,
        target_industry_or_category: target,
        industry_key: industryKey,
        mapped_valid_categories: mappedCategories,
        suggested_interests,
        suggested_demographics,
        interest_strength: strength,
        rationale: buildRationale({
          companyName: company_name,
          industryKey,
          suggested: suggested_interests,
          strength,
          scope: "athlete",
        }),
      },
      audience
    );
  }

  if (mappedCategories.length > 0 && needsRosterRanking) {
    const rosterIds = await getRosterAthleteIdsForProfile(params.supabase, params.profile);
    if (rosterIds.length > 0) {
      return curatePitchInterests({
        ...params,
        pitch_type: "roster_aggregate",
      });
    }
  }

  const fallbackNames = mappedCategories.slice(0, maxSuggestions);
  const suggested_interests = fallbackNames.map((interest_name) => ({
    interest_name,
    athlete_pct: null,
    roster_audience_count: null,
    roster_athlete_count: null,
  }));
  const strength = fallbackNames.length ? "weak" : "unknown";
  return attachSuggestedAngles(
    {
      pitch_type,
      company_name,
      target_industry_or_category: target,
      industry_key: industryKey,
      mapped_valid_categories: mappedCategories,
      suggested_interests,
      suggested_demographics: [],
      interest_strength: strength,
      rationale: buildRationale({
        companyName: company_name,
        industryKey,
        suggested: suggested_interests,
        strength,
        scope: "athlete",
      }),
    },
    null
  );
}
