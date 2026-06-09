import type { SupabaseClient } from "@supabase/supabase-js";

export type AthleteSocialData = {
  athlete_id: string;
  talent_id: string | null;
  total_followers: number;
  avg_er_20p: number | null;
  ig_followers: number | null;
  avg_er_ig_20p: number | null;
  ig_lifetime_posts: number | null;
  tt_followers: number | null;
  avg_er_tt_20p: number | null;
  fb_followers: number | null;
  avg_er_fb_20p: number | null;
  x_followers: number | null;
  avg_er_x_20p: number | null;
  total_lifetime_posts: number | null;
  tt_lifetime_posts: number | null;
  fb_lifetime_posts: number | null;
  x_lifetime_posts: number | null;
};

export type AudienceRow = {
  audience_category: "Brands" | "Cities" | "Combined_Age" | "Countries" | "Ethnicity" | "Gender" | "Interests" | "States";
  audience_name: string;
  /** Canonical fraction of IG audience in 0–1 (e.g. 0.0779 = 7.79%). */
  ig_audience_percent: number;
  ig_audience_count: number;
};

export type AthleteAudienceProfile = {
  social: AthleteSocialData | null;
  brands: AudienceRow[];
  interests: AudienceRow[];
  gender: AudienceRow[];
  age: AudienceRow[];
  countries: AudienceRow[];
  states: AudienceRow[];
  cities: AudienceRow[];
  ethnicity: AudienceRow[];
};

/**
 * Normalize `athlete_audience_data.ig_audience_percent` to a 0–1 fraction.
 * Some rows store a fraction (e.g. 0.0779); after rescaling migrations many store 0–100 (e.g. 7.79).
 */
export function normalizeIgAudiencePercentToFraction(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw > 1) return raw / 100;
  return raw;
}

/**
 * Canonical 0–1 audience share. When count and current_ig_following are present,
 * count / following is authoritative — some imported rows store ig_audience_percent ~100× too high.
 */
export function resolveAudiencePercentFraction(
  rawPercent: number,
  count: number,
  following: number | null | undefined
): number {
  if (
    following != null &&
    Number.isFinite(following) &&
    following > 0 &&
    count >= 0 &&
    Number.isFinite(count)
  ) {
    return count / following;
  }
  return normalizeIgAudiencePercentToFraction(rawPercent);
}

export function mapAudienceDataRow(r: {
  audience_category: string;
  audience_name: string;
  ig_audience_percent: unknown;
  ig_audience_count: unknown;
  current_ig_following?: unknown;
}): AudienceRow {
  const count = Number(r.ig_audience_count ?? 0);
  const following = r.current_ig_following != null ? Number(r.current_ig_following) : null;
  return {
    audience_category: r.audience_category as AudienceRow["audience_category"],
    audience_name: String(r.audience_name ?? ""),
    ig_audience_percent: resolveAudiencePercentFraction(Number(r.ig_audience_percent ?? 0), count, following),
    ig_audience_count: count,
  };
}

/** Numeric percent points 0–100 for APIs / charts (same semantics as fmtPct). */
export function audiencePercentPoints(raw: number): number {
  return normalizeIgAudiencePercentToFraction(raw) * 100;
}

/** Format audience share to a display string e.g. "7.8%" (always 0–100 scale). */
export function fmtPct(val: number): string {
  return `${audiencePercentPoints(val).toFixed(1)}%`;
}

/** Sort audience rows by normalized share (desc), then count as tiebreaker. */
export function sortAudienceRowsByPercentDesc(rows: AudienceRow[]): AudienceRow[] {
  return [...rows].sort((a, b) => {
    const pctDiff = b.ig_audience_percent - a.ig_audience_percent;
    if (pctDiff !== 0) return pctDiff;
    return b.ig_audience_count - a.ig_audience_count;
  });
}

/** Fetch full audience profile for one athlete from the two source-of-truth tables */
export async function getAthleteAudienceProfile(
  supabase: SupabaseClient,
  athleteId: string
): Promise<AthleteAudienceProfile> {
  const [socialRes, audienceRes] = await Promise.all([
    supabase.from("athlete_social_data").select("*").eq("athlete_id", athleteId).maybeSingle(),
    supabase
      .from("athlete_audience_data")
      .select("audience_category, audience_name, ig_audience_percent, ig_audience_count, current_ig_following")
      .eq("athlete_id", athleteId),
  ]);

  const rows: AudienceRow[] = (audienceRes.data ?? []).map((r: any) => mapAudienceDataRow(r));

  const byCategory = (category: AudienceRow["audience_category"]) =>
    sortAudienceRowsByPercentDesc(rows.filter((r) => r.audience_category === category));

  return {
    social: socialRes.data ?? null,
    brands: byCategory("Brands"),
    interests: byCategory("Interests"),
    gender: byCategory("Gender"),
    age: byCategory("Combined_Age"),
    countries: byCategory("Countries"),
    states: byCategory("States"),
    cities: byCategory("Cities"),
    ethnicity: byCategory("Ethnicity"),
  };
}

/** Format engagement rate (raw decimal) to display e.g. "3.40%" — same scale as audiencePercentPoints. */
export function fmtEngagementRate(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(Number(val))) return "—";
  return `${audiencePercentPoints(Number(val)).toFixed(2)}%`;
}

/** Format lifetime post count for display. */
export function fmtPostCount(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(Number(val))) return "—";
  return Number(val).toLocaleString();
}

/** Format follower count to display string e.g. "1.2M", "45.3K" */
export function fmtFollowers(val: number | null): string {
  if (!val) return "—";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}
