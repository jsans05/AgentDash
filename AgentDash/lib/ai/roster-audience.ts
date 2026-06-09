import type { Profile } from "@/lib/supabase/types";
import type { createServerClient } from "@/lib/supabase/server";
import { normalizeIgAudiencePercentToFraction } from "@/lib/athlete-data";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";
import { canonicalInterestByNormalized } from "@/lib/industry-interest-map";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function formatRosterAudienceCountDisplay(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} million`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function effectiveIgInterestCount(
  igAudienceCount: number | null | undefined,
  igAudiencePercentRaw: number | null | undefined,
  igFollowersForEstimate: number
): number {
  const direct = Math.floor(Number(igAudienceCount ?? 0));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const pct = normalizeIgAudiencePercentToFraction(Number(igAudiencePercentRaw ?? 0));
  const ig = Math.max(0, Math.floor(Number(igFollowersForEstimate) || 0));
  if (pct > 0 && ig > 0) return Math.round(pct * ig);
  return 0;
}

async function getAgentAccessibleAthleteIds(supabase: SupabaseClient, profile: Profile): Promise<string[]> {
  const [{ data: linked }, { data: primary }] = await Promise.all([
    supabase.from("athlete_agents").select("athlete_id").eq("user_id", profile.user_id),
    supabase.from("athletes").select("athlete_id").eq("current_agent_id", profile.user_id),
  ]);
  const ids = new Set<string>();
  for (const r of linked ?? []) {
    const id = (r as { athlete_id?: string })?.athlete_id;
    if (id) ids.add(String(id));
  }
  for (const r of primary ?? []) {
    const id = (r as { athlete_id?: string })?.athlete_id;
    if (id) ids.add(String(id));
  }
  return [...ids];
}

export async function getRosterAthleteIdsForProfile(
  supabase: SupabaseClient,
  profile: Profile
): Promise<string[]> {
  if (profile.role === "admin" || profile.role === "sales") {
    const { data, error } = await supabase.from("athletes").select("athlete_id");
    if (error) throw error;
    return (data ?? []).map((r: { athlete_id?: string }) => String(r.athlete_id ?? "")).filter(Boolean);
  }
  if (profile.role === "agent") {
    return getAgentAccessibleAthleteIds(supabase, profile);
  }
  return [];
}

export async function fetchDistinctInterestNamesOnRoster(
  supabase: SupabaseClient,
  rosterIds: string[]
): Promise<string[]> {
  if (!rosterIds.length) return [];
  const names = new Set<string>();
  for (const chunk of chunkArray(rosterIds, 200)) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select("audience_name")
      .eq("audience_category", "Interests")
      .in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const n = String((r as { audience_name?: string | null }).audience_name ?? "").trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

export function resolveInterestNamesForRoster(interestInput: string[], distinctNamesOnRoster: string[]): string[] {
  const lowerToCanonical = new Map<string, string>();
  for (const n of distinctNamesOnRoster) {
    const t = String(n ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!lowerToCanonical.has(k)) lowerToCanonical.set(k, t);
  }
  for (const c of APPROVED_INTEREST_CATEGORIES) {
    const k = c.toLowerCase();
    if (!lowerToCanonical.has(k)) lowerToCanonical.set(k, c);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of interestInput) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const canon = lowerToCanonical.get(t.toLowerCase());
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

async function fetchIgFollowersByAthleteId(
  supabase: SupabaseClient,
  athleteIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!athleteIds.length) return map;
  for (const chunk of chunkArray(athleteIds, 200)) {
    const { data, error } = await supabase
      .from("athlete_social_data")
      .select("athlete_id, ig_followers, total_followers")
      .in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const id = String((r as { athlete_id?: string }).athlete_id ?? "");
      if (!id) continue;
      const ig = Number((r as { ig_followers?: number | null }).ig_followers ?? 0);
      const tot = Number((r as { total_followers?: number | null }).total_followers ?? 0);
      const base = ig > 0 ? ig : tot;
      map.set(id, Math.max(0, Math.floor(base)));
    }
  }
  return map;
}

async function rosterTotalFollowers(supabase: SupabaseClient, rosterIds: string[]): Promise<number> {
  if (!rosterIds.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(rosterIds, 200)) {
    const { data, error } = await supabase.from("athlete_social_data").select("total_followers").in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      total += Number((r as { total_followers?: number | null }).total_followers ?? 0);
    }
  }
  return total;
}

export type RosterAudienceSummary = {
  roster_total_athletes: number;
  roster_total_followers: number;
  total_audience_count: number;
  matched_athlete_count: number;
  interest_breakdown: Array<{
    interest_name: string;
    total_ig_audience_count: number;
    athlete_count: number;
  }>;
  total_audience_display: string;
  roster_followers_display: string;
};

export async function computeRosterAudienceSummary(
  supabase: SupabaseClient,
  profile: Profile,
  interestNames: string[]
): Promise<RosterAudienceSummary> {
  const interestInput = interestNames.map((s) => String(s ?? "").trim()).filter(Boolean);
  const rosterIds = await getRosterAthleteIdsForProfile(supabase, profile);
  const roster_total_athletes = rosterIds.length;
  const roster_total_followers = await rosterTotalFollowers(supabase, rosterIds);

  const emptyBreakdown: RosterAudienceSummary["interest_breakdown"] = [];

  if (!interestInput.length) {
    return {
      roster_total_athletes,
      roster_total_followers,
      total_audience_count: 0,
      matched_athlete_count: 0,
      interest_breakdown: emptyBreakdown,
      total_audience_display: formatRosterAudienceCountDisplay(0),
      roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
    };
  }

  if (!rosterIds.length) {
    return {
      roster_total_athletes: 0,
      roster_total_followers: 0,
      total_audience_count: 0,
      matched_athlete_count: 0,
      interest_breakdown: emptyBreakdown,
      total_audience_display: formatRosterAudienceCountDisplay(0),
      roster_followers_display: formatRosterAudienceCountDisplay(0),
    };
  }

  const distinctOnRoster = await fetchDistinctInterestNamesOnRoster(supabase, rosterIds);
  const resolvedInterestNames = resolveInterestNamesForRoster(interestInput, distinctOnRoster);

  if (!resolvedInterestNames.length) {
    return {
      roster_total_athletes,
      roster_total_followers,
      total_audience_count: 0,
      matched_athlete_count: 0,
      interest_breakdown: emptyBreakdown,
      total_audience_display: formatRosterAudienceCountDisplay(0),
      roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
    };
  }

  const audienceRows: Array<{
    athlete_id: string;
    audience_name: string;
    ig_audience_count: number | null;
    ig_audience_percent: number | null;
  }> = [];

  for (const chunk of chunkArray(rosterIds, 200)) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select("athlete_id, audience_name, ig_audience_count, ig_audience_percent")
      .eq("audience_category", "Interests")
      .in("audience_name", resolvedInterestNames)
      .in("athlete_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      audienceRows.push(row as (typeof audienceRows)[number]);
    }
  }

  const athleteIdsNeedingFollowers = [...new Set(audienceRows.map((r) => String(r.athlete_id ?? "")).filter(Boolean))];
  const igFollowersByAthlete = await fetchIgFollowersByAthleteId(supabase, athleteIdsNeedingFollowers);

  let total_audience_count = 0;
  const matchedAthletes = new Set<string>();
  const sumByInterest = new Map<string, number>();
  const athletesByInterest = new Map<string, Set<string>>();

  for (const row of audienceRows) {
    const aid = String(row.athlete_id ?? "");
    const name = String(row.audience_name ?? "");
    if (!aid || !name) continue;
    const igBase = igFollowersByAthlete.get(aid) ?? 0;
    const cnt = effectiveIgInterestCount(row.ig_audience_count, row.ig_audience_percent, igBase);
    total_audience_count += cnt;
    matchedAthletes.add(aid);
    sumByInterest.set(name, (sumByInterest.get(name) ?? 0) + cnt);
    const set = athletesByInterest.get(name) ?? new Set<string>();
    set.add(aid);
    athletesByInterest.set(name, set);
  }

  const interest_breakdown = resolvedInterestNames.map((interest_name) => ({
    interest_name,
    total_ig_audience_count: sumByInterest.get(interest_name) ?? 0,
    athlete_count: athletesByInterest.get(interest_name)?.size ?? 0,
  }));
  interest_breakdown.sort((a, b) => b.total_ig_audience_count - a.total_ig_audience_count);

  return {
    roster_total_athletes,
    roster_total_followers,
    total_audience_count,
    matched_athlete_count: matchedAthletes.size,
    interest_breakdown,
    total_audience_display: formatRosterAudienceCountDisplay(total_audience_count),
    roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
  };
}

/** Rank mapped brand interests by aggregated IG audience on the roster. */
export async function rankMappedInterestsOnRoster(
  supabase: SupabaseClient,
  profile: Profile,
  mappedInterestNames: string[],
  maxResults = 5
): Promise<Array<{ interest_name: string; total_ig_audience_count: number; athlete_count: number }>> {
  if (!mappedInterestNames.length) return [];
  const summary = await computeRosterAudienceSummary(supabase, profile, mappedInterestNames);
  return summary.interest_breakdown
    .filter((row) => row.total_ig_audience_count > 0)
    .slice(0, maxResults);
}

export function canonicalizeInterestLabel(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const normalized = t.toLowerCase().replace(/\s+/g, " ");
  return canonicalInterestByNormalized[normalized] ?? null;
}
