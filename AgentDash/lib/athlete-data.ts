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

/** Numeric percent points 0–100 for APIs / charts (same semantics as fmtPct). */
export function audiencePercentPoints(raw: number): number {
  return normalizeIgAudiencePercentToFraction(raw) * 100;
}

/** Format audience share to a display string e.g. "7.8%" (always 0–100 scale). */
export function fmtPct(val: number): string {
  return `${audiencePercentPoints(val).toFixed(1)}%`;
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
      .select("audience_category, audience_name, ig_audience_percent, ig_audience_count")
      .eq("athlete_id", athleteId)
      .order("ig_audience_percent", { ascending: false }),
  ]);

  const rows: AudienceRow[] = (audienceRes.data ?? []).map((r: any) => ({
    audience_category: r.audience_category,
    audience_name: r.audience_name,
    ig_audience_percent: normalizeIgAudiencePercentToFraction(Number(r.ig_audience_percent)),
    ig_audience_count: Number(r.ig_audience_count),
  }));

  return {
    social: socialRes.data ?? null,
    brands: rows.filter((r) => r.audience_category === "Brands"),
    interests: rows.filter((r) => r.audience_category === "Interests"),
    gender: rows.filter((r) => r.audience_category === "Gender"),
    age: rows.filter((r) => r.audience_category === "Combined_Age"),
    countries: rows.filter((r) => r.audience_category === "Countries"),
    states: rows.filter((r) => r.audience_category === "States"),
    cities: rows.filter((r) => r.audience_category === "Cities"),
    ethnicity: rows.filter((r) => r.audience_category === "Ethnicity"),
  };
}

/** Format follower count to display string e.g. "1.2M", "45.3K" */
export function fmtFollowers(val: number | null): string {
  if (!val) return "—";
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return String(val);
}
