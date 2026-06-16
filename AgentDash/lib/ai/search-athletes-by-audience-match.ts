import type { SupabaseClient } from "@supabase/supabase-js";
import { audiencePercentPoints, normalizeIgAudiencePercentToFraction } from "@/lib/athlete-data";
import { canonicalInterestByNormalized } from "@/lib/industry-interest-map";
import { ilikeContains, normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import type { Profile } from "@/lib/supabase/types";

export type SearchAthletesByAudienceMatchParams = {
  interest_names?: string[];
  sports?: string[];
  interest_keywords?: string[];
  min_total_followers?: number;
  limit?: number;
};

type GroupedSportResult = {
  sport: string;
  athletes: {
    athlete_id: string;
    name: string;
    total_ig_audience_count: number;
    total_followers: number | null;
    interests: {
      audience_name: string;
      ig_audience_percent: number;
      ig_audience_pct_display: string;
      ig_audience_count: number;
    }[];
  }[];
};

type FlatAthleteResult = {
  athlete_id: string;
  name: string;
  sport: string | null;
  total_followers: number | null;
  audience_name?: string;
  audience_category?: string;
  ig_audience_percent?: number;
  ig_audience_pct_display?: string;
  ig_audience_count?: number;
  matched_interest?: string;
};

export type SearchAthletesByAudienceMatchResult =
  | { error: string }
  | { sports: GroupedSportResult[] }
  | { athletes: FlatAthleteResult[]; searched_interests?: string[] };

async function getAccessibleAthleteIds(supabase: SupabaseClient, profile: Profile): Promise<string[]> {
  if (profile.role === "admin" || profile.role === "sales") {
    const { data: allAthletes } = await supabase.from("athletes").select("athlete_id");
    return (allAthletes ?? []).map((a: { athlete_id: string }) => String(a.athlete_id));
  }
  const { data: linked } = await supabase
    .from("athlete_agents")
    .select("athlete_id")
    .eq("user_id", profile.user_id);
  return (linked ?? []).map((r: { athlete_id: string }) => String(r.athlete_id));
}

function normalizeInterestLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function expandInterestKeywords(inputKeywords: string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    const kk = k.trim();
    if (!kk) return;
    const key = kk.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push(kk);
  };

  for (const k of inputKeywords) {
    const canonical = canonicalInterestByNormalized[normalizeInterestLabel(k)];
    if (canonical) {
      push(canonical);
      if (canonical === "Healthy Lifestyle") {
        push("Fitness & Yoga");
        push("Sports");
        push("Activewear");
      }
    } else if (k.trim()) {
      push(k.trim());
    }
  }
  return expanded;
}

function resolveTotalFollowers(social: {
  total_followers?: number | null;
  ig_followers?: number | null;
  tt_followers?: number | null;
  fb_followers?: number | null;
  x_followers?: number | null;
} | null | undefined): number | null {
  if (!social) return null;
  if (social.total_followers != null && Number.isFinite(Number(social.total_followers))) {
    return Number(social.total_followers);
  }
  const sum =
    Number(social.ig_followers ?? 0) +
    Number(social.tt_followers ?? 0) +
    Number(social.fb_followers ?? 0) +
    Number(social.x_followers ?? 0);
  return sum > 0 ? sum : null;
}

async function searchGroupedBySport(
  supabase: SupabaseClient,
  profile: Profile,
  interestNames: string[],
  selectedSports: string[],
  minFollowers: number | null
): Promise<{ sports: GroupedSportResult[] }> {
  const accessibleAthleteIds = await getAccessibleAthleteIds(supabase, profile);
  if (accessibleAthleteIds.length === 0) return { sports: [] };

  const sportOrFilter = selectedSports
    .map((s) => `sport.ilike.%${normalizeOrIlikeFragment(s)}%`)
    .join(",");

  const { data: athletesInSports } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport")
    .in("athlete_id", accessibleAthleteIds)
    .or(sportOrFilter);

  const athletesInSportsList = athletesInSports ?? [];
  if (athletesInSportsList.length === 0) return { sports: [] };

  const athletesInSportsIds = athletesInSportsList.map((a: { athlete_id: string }) => a.athlete_id);
  const athleteById = new Map(athletesInSportsList.map((a) => [a.athlete_id, a]));

  const { data: audienceRows } = await supabase
    .from("athlete_audience_data")
    .select("athlete_id, audience_name, ig_audience_percent, ig_audience_count")
    .in("athlete_id", athletesInSportsIds)
    .eq("audience_category", "Interests")
    .in("audience_name", interestNames);

  const rows = audienceRows ?? [];
  if (rows.length === 0) return { sports: [] };

  type AthleteScore = {
    athlete_id: string;
    total_ig_audience_count: number;
    interests: {
      audience_name: string;
      ig_audience_percent: number;
      ig_audience_count: number;
    }[];
  };

  const scoreMap = new Map<string, AthleteScore>();
  for (const row of rows) {
    const id = row.athlete_id as string;
    if (!scoreMap.has(id)) {
      scoreMap.set(id, { athlete_id: id, total_ig_audience_count: 0, interests: [] });
    }
    const entry = scoreMap.get(id)!;
    entry.total_ig_audience_count += Number(row.ig_audience_count ?? 0);
    entry.interests.push({
      audience_name: row.audience_name as string,
      ig_audience_percent: Number(row.ig_audience_percent ?? 0),
      ig_audience_count: Number(row.ig_audience_count ?? 0),
    });
  }

  const scoredAthleteIds = [...scoreMap.keys()];
  const { data: socialRows } = await supabase
    .from("athlete_social_data")
    .select("athlete_id, total_followers, ig_followers, tt_followers, fb_followers, x_followers")
    .in("athlete_id", scoredAthleteIds);
  const socialById = new Map(
    (socialRows ?? []).map((s) => [String(s.athlete_id), s])
  );

  const sportGroupMap = new Map<string, AthleteScore[]>();
  for (const [athlete_id, score] of scoreMap.entries()) {
    const athlete = athleteById.get(athlete_id);
    if (!athlete) continue;
    if (minFollowers != null) {
      const followers = resolveTotalFollowers(socialById.get(athlete_id));
      if (followers == null || followers < minFollowers) continue;
    }
    const sport = athlete.sport as string;
    if (!sportGroupMap.has(sport)) sportGroupMap.set(sport, []);
    sportGroupMap.get(sport)!.push(score);
  }

  const result: GroupedSportResult[] = [];
  const sortedSports = [...sportGroupMap.keys()].sort((a, b) => b.localeCompare(a));

  for (const sport of sortedSports) {
    const group = sportGroupMap.get(sport)!;
    group.sort((a, b) => b.total_ig_audience_count - a.total_ig_audience_count);
    const top5 = group.slice(0, 5);

    result.push({
      sport,
      athletes: top5.map((score) => {
        const athlete = athleteById.get(score.athlete_id)!;
        return {
          athlete_id: score.athlete_id,
          name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" "),
          total_ig_audience_count: score.total_ig_audience_count,
          total_followers: resolveTotalFollowers(socialById.get(score.athlete_id)),
          interests: score.interests
            .sort((a, b) => b.ig_audience_percent - a.ig_audience_percent)
            .map((i) => ({
              audience_name: i.audience_name,
              ig_audience_percent: i.ig_audience_percent,
              ig_audience_pct_display: `${(i.ig_audience_percent * 100).toFixed(1)}%`,
              ig_audience_count: i.ig_audience_count,
            })),
        };
      }),
    });
  }

  return { sports: result };
}

async function searchFlat(
  supabase: SupabaseClient,
  profile: Profile,
  interestNames: string[],
  selectedSports: string[],
  expandedKeywords: string[],
  minFollowers: number | null,
  outputLimit: number
): Promise<{ athletes: FlatAthleteResult[]; searched_interests?: string[] }> {
  const accessibleAthleteIds = await getAccessibleAthleteIds(supabase, profile);
  if (!accessibleAthleteIds.length) return { athletes: [] };

  let athleteQuery = supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport")
    .in("athlete_id", accessibleAthleteIds);

  if (selectedSports.length > 0) {
    const sportOrFilter = selectedSports
      .map((s) => `sport.ilike.%${normalizeOrIlikeFragment(s)}%`)
      .join(",");
    athleteQuery = athleteQuery.or(sportOrFilter);
  }

  const { data: athleteRows } = await athleteQuery;
  let candidates = athleteRows ?? [];
  if (!candidates.length) return { athletes: [] };

  const candidateIds = candidates.map((a: { athlete_id: string }) => a.athlete_id);
  const { data: socialRows } = await supabase
    .from("athlete_social_data")
    .select("athlete_id, total_followers, ig_followers, tt_followers, fb_followers, x_followers")
    .in("athlete_id", candidateIds);
  const socialById = new Map(
    (socialRows ?? []).map((s) => [String(s.athlete_id), s])
  );

  if (minFollowers != null) {
    candidates = candidates.filter((a: { athlete_id: string }) => {
      const followers = resolveTotalFollowers(socialById.get(a.athlete_id));
      return followers != null && followers >= minFollowers;
    });
  }
  if (!candidates.length) return { athletes: [] };

  const filteredIds = candidates.map((a: { athlete_id: string }) => a.athlete_id);
  const athleteById = new Map(candidates.map((a) => [a.athlete_id, a]));

  if (interestNames.length === 0 && expandedKeywords.length === 0) {
    const athletes = candidates
      .map((a: { athlete_id: string; first_name?: string | null; last_name?: string | null; sport?: string | null }) => ({
        athlete_id: a.athlete_id,
        name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.athlete_id,
        sport: a.sport ?? null,
        total_followers: resolveTotalFollowers(socialById.get(a.athlete_id)),
      }))
      .sort((a, b) => Number(b.total_followers ?? 0) - Number(a.total_followers ?? 0))
      .slice(0, outputLimit);
    return { athletes };
  }

  type FlatMatch = FlatAthleteResult & { _sortPct: number };
  const matches: FlatMatch[] = [];

  if (interestNames.length > 0) {
    const { data: audienceRows } = await supabase
      .from("athlete_audience_data")
      .select("athlete_id, audience_category, audience_name, ig_audience_percent, ig_audience_count")
      .in("athlete_id", filteredIds)
      .eq("audience_category", "Interests")
      .in("audience_name", interestNames);

    for (const row of audienceRows ?? []) {
      const athleteId = String(row.athlete_id);
      const athlete = athleteById.get(athleteId);
      if (!athlete) continue;
      const raw = Number(row.ig_audience_percent ?? 0);
      const sortPct = normalizeIgAudiencePercentToFraction(raw);
      matches.push({
        athlete_id: athleteId,
        name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || athleteId,
        sport: athlete.sport ?? null,
        total_followers: resolveTotalFollowers(socialById.get(athleteId)),
        audience_name: String(row.audience_name ?? ""),
        audience_category: String(row.audience_category ?? ""),
        ig_audience_percent: audiencePercentPoints(raw),
        ig_audience_pct_display: `${audiencePercentPoints(raw).toFixed(1)}%`,
        ig_audience_count: Number(row.ig_audience_count ?? 0),
        matched_interest: String(row.audience_name ?? ""),
        _sortPct: sortPct,
      });
    }
  }

  for (const keyword of expandedKeywords) {
    const { data: audienceRows } = await supabase
      .from("athlete_audience_data")
      .select("athlete_id, audience_category, audience_name, ig_audience_percent, ig_audience_count")
      .in("athlete_id", filteredIds)
      .in("audience_category", ["Interests", "Brands"])
      .ilike("audience_name", ilikeContains(keyword))
      .order("ig_audience_percent", { ascending: false })
      .limit(500);

    for (const row of audienceRows ?? []) {
      const athleteId = String(row.athlete_id);
      const athlete = athleteById.get(athleteId);
      if (!athlete) continue;

      const audienceName = String(row.audience_name ?? "");
      const canonical =
        row.audience_category === "Interests"
          ? canonicalInterestByNormalized[normalizeInterestLabel(audienceName)]
          : null;
      if (row.audience_category === "Interests" && !canonical) continue;

      const raw = Number(row.ig_audience_percent ?? 0);
      const sortPct = normalizeIgAudiencePercentToFraction(raw);
      matches.push({
        athlete_id: athleteId,
        name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || athleteId,
        sport: athlete.sport ?? null,
        total_followers: resolveTotalFollowers(socialById.get(athleteId)),
        audience_name: canonical ?? audienceName,
        audience_category: String(row.audience_category ?? ""),
        ig_audience_percent: audiencePercentPoints(raw),
        ig_audience_pct_display: `${audiencePercentPoints(raw).toFixed(1)}%`,
        ig_audience_count: Number(row.ig_audience_count ?? 0),
        matched_interest: keyword,
        _sortPct: sortPct,
      });
    }
  }

  const bestByAthlete = new Map<string, FlatMatch>();
  for (const match of matches) {
    const current = bestByAthlete.get(match.athlete_id);
    if (!current || match._sortPct > current._sortPct) {
      bestByAthlete.set(match.athlete_id, match);
    }
  }

  const athletes = [...bestByAthlete.values()]
    .sort((a, b) => b._sortPct - a._sortPct)
    .slice(0, outputLimit)
    .map(({ _sortPct: _ignored, ...rest }) => rest);

  return {
    athletes,
    searched_interests: expandedKeywords.length ? expandedKeywords : undefined,
  };
}

export async function searchAthletesByAudienceMatch(
  supabase: SupabaseClient,
  profile: Profile,
  params: SearchAthletesByAudienceMatchParams
): Promise<SearchAthletesByAudienceMatchResult> {
  const interestNames = (params.interest_names ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const selectedSports = (params.sports ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const inputKeywords = (params.interest_keywords ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  const minFollowers =
    params.min_total_followers != null && Number.isFinite(Number(params.min_total_followers))
      ? Math.max(0, Number(params.min_total_followers))
      : null;
  const outputLimit = Math.max(1, Math.min(params.limit ?? 50, 200));

  const hasInterestNames = interestNames.length > 0;
  const hasSports = selectedSports.length > 0;
  const hasKeywords = inputKeywords.length > 0;

  if (!hasInterestNames && !hasSports && !hasKeywords && minFollowers == null) {
    return {
      error: "At least one filter parameter is required (interest_names, sports, interest_keywords, or min_total_followers).",
    };
  }

  if (hasInterestNames && hasSports) {
    return searchGroupedBySport(supabase, profile, interestNames, selectedSports, minFollowers);
  }

  const expandedKeywords = hasKeywords ? expandInterestKeywords(inputKeywords) : [];
  return searchFlat(
    supabase,
    profile,
    interestNames,
    selectedSports,
    expandedKeywords,
    minFollowers,
    outputLimit
  );
}
