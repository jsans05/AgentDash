/**
 * Unified audience metrics: CreatorIQ first, then manual snapshot fallback.
 * Returns a normalized shape for the rest of the app.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAudienceSummary } from "./creatoriq-summary";
import type { GenderSlice, AgeBucket, LocationItem, InterestItem } from "./creatoriq-summary";
import { getAudienceRoot, parseBrandsFromAudience } from "./ciq/overview";

/** Normalized audience summary (same shape as getAudienceSummary + brands). */
export type NormalizedAudienceSummary = {
  gender: GenderSlice[];
  age: AgeBucket[];
  countries: LocationItem[];
  states: LocationItem[];
  cities: LocationItem[];
  interests: InterestItem[];
  brands: InterestItem[];
};

export type AudienceMetricsResult = {
  summary: NormalizedAudienceSummary;
  source: "creatoriq" | "manual" | null;
  fetchedAt?: string;
};

const EMPTY: NormalizedAudienceSummary = {
  gender: [],
  age: [],
  countries: [],
  states: [],
  cities: [],
  interests: [],
  brands: [],
};

/** Consider CreatorIQ audience "recent" if within this many days. */
const CIQ_RECENT_DAYS = 90;

function toLocationItem(o: { name?: string; pct?: number }): LocationItem {
  const name = typeof o?.name === "string" ? o.name.trim() : "";
  const pct = typeof o?.pct === "number" ? o.pct : 0;
  return { name: name || "—", value: pct };
}

function toInterestItem(o: { name?: string; pct?: number }): InterestItem {
  const name = typeof o?.name === "string" ? o.name.trim() : "";
  const pct = typeof o?.pct === "number" ? o.pct : 0;
  return { name: name || "—", value: pct };
}

/** Convert manual_audience_snapshots row to NormalizedAudienceSummary. */
export function manualSnapshotToSummary(row: {
  gender?: Record<string, number> | null;
  age?: Record<string, number> | null;
  top_countries?: Array<{ name?: string; pct?: number }> | null;
  top_cities?: Array<{ name?: string; pct?: number }> | null;
  top_states?: Array<{ name?: string; pct?: number }> | null;
  brands?: Array<{ name?: string; pct?: number }> | null;
  interests?: Array<{ name?: string; pct?: number }> | null;
  ethnicity?: Record<string, number> | null;
}): NormalizedAudienceSummary {
  const gender: GenderSlice[] = [];
  if (row.gender?.female != null) gender.push({ label: "Female", value: Number(row.gender.female) });
  if (row.gender?.male != null) gender.push({ label: "Male", value: Number(row.gender.male) });

  const ageOrder = ["u18", "a18_24", "a25_34", "a35_44", "a45_54", "a55_64", "o64"] as const;
  const ageLabels: Record<string, string> = {
    u18: "< 18",
    a18_24: "18-24",
    a25_34: "25-34",
    a35_44: "35-44",
    a45_54: "45-54",
    a55_64: "55-64",
    o64: "65+",
  };
  const age: AgeBucket[] = [];
  for (const k of ageOrder) {
    const v = row.age?.[k];
    if (v != null) age.push({ label: ageLabels[k] ?? k, value: Number(v) });
  }

  const countries = (row.top_countries ?? []).map(toLocationItem).filter((c) => c.name && c.name !== "—");
  const cities = (row.top_cities ?? []).map(toLocationItem).filter((c) => c.name && c.name !== "—");
  const states = (row.top_states ?? []).map(toLocationItem).filter((c) => c.name && c.name !== "—");
  const interests = (row.interests ?? []).map(toInterestItem).filter((i) => i.name && i.name !== "—");
  const brands = (row.brands ?? []).map(toInterestItem).filter((i) => i.name && i.name !== "—");

  return {
    gender,
    age,
    countries,
    states,
    cities,
    interests,
    brands,
  };
}

function isRecent(fetchedAt: string | undefined): boolean {
  if (!fetchedAt) return false;
  const t = new Date(fetchedAt).getTime();
  const now = Date.now();
  return (now - t) / (24 * 60 * 60 * 1000) <= CIQ_RECENT_DAYS;
}

/**
 * Get unified audience metrics for an athlete.
 * Uses CreatorIQ audience snapshot if present and recent; otherwise manual snapshot (is_active=true).
 */
export async function getAudienceMetrics(
  supabase: SupabaseClient,
  athleteId: string
): Promise<AudienceMetricsResult> {
  const { data: snapshots } = await supabase
    .from("creatoriq_snapshots")
    .select("snapshot_type, raw_json, fetched_at")
    .eq("athlete_id", athleteId)
    .eq("snapshot_type", "audience")
    .order("fetched_at", { ascending: false })
    .limit(1);

  const ciqAudience = snapshots?.[0] as
    | { raw_json: unknown; fetched_at?: string }
    | undefined;
  if (ciqAudience?.raw_json && isRecent(ciqAudience.fetched_at)) {
    const raw = ciqAudience.raw_json as Record<string, unknown>;
    const fromCiq = getAudienceSummary(raw);
    const root = getAudienceRoot(raw);
    const brands = parseBrandsFromAudience(root);
    return {
      summary: {
        ...fromCiq,
        brands,
      },
      source: "creatoriq",
      fetchedAt: ciqAudience.fetched_at,
    };
  }

  const { data: manualRows } = await supabase
    .from("manual_audience_snapshots")
    .select("*")
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .order("captured_at", { ascending: false })
    .limit(1);

  const manual = manualRows?.[0];
  if (manual) {
    return {
      summary: manualSnapshotToSummary(manual),
      source: "manual",
      fetchedAt: manual.captured_at,
    };
  }

  return { summary: EMPTY, source: null };
}
