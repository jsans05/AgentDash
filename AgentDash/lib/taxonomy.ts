/**
 * Sport-specific sponsorship taxonomies.
 * ENDEMIC rows are per sport; NON_ENDEMIC rows live under TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT (single list for all sports).
 */

import { createServerClient } from "@/lib/supabase/server";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";

export type TaxonomyBySport = {
  endemic: string[];
  nonEndemic: string[];
  all: string[];
};

export { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT, isAthleteTaxonomySport } from "@/lib/taxonomy-constants";

const MOTO_CANONICAL = "Supercross / Motocross (Moto)";
const RACING_CANONICAL = "Racing / Motorsports";

export type TaxonomyNodeRow = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
};

/** Normalize category for comparison: lowercase, trim, collapse whitespace. */
export function normalizeCategoryForMatch(cat: string): string {
  return cat
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Map roster/display sport values to canonical taxonomy sport names (sponsorship_taxonomies.sport for ENDEMIC).
 * Roster may use different labels than the taxonomy row sport column.
 */
const SPORT_ALIAS_TO_CANONICAL: Record<string, string> = {
  "motorsports/two wheel - supercross/motocross": MOTO_CANONICAL,
  "motorsports / two wheel - supercross / motocross": MOTO_CANONICAL,
  "supercross/motocross": MOTO_CANONICAL,
  "supercross / motocross (moto)": MOTO_CANONICAL,
  "supercross": MOTO_CANONICAL,
  "motocross": MOTO_CANONICAL,
  "moto": MOTO_CANONICAL,
  "racing / motorsports": RACING_CANONICAL,
  "racing/motorsports": RACING_CANONICAL,
  /** Bare "motorsports" resolved only after 2W/4W heuristics (see resolveSportToCanonical). */
  motorsports: RACING_CANONICAL,
  "mountain bike": "Mountain Bike",
  "mountain biking": "Mountain Bike",
  "track & field": "Track & Field",
  "track and field": "Track & Field",
  "outdoor / climbing": "Outdoor / Climbing",
  "outdoor/climbing": "Outdoor / Climbing",
  "lifestyle / broadcast / chef / personality": "Lifestyle / Broadcast / Chef / Personality",
  /** Roster "Snow - …" / OpenSnowboard-style groupings → per-discipline taxonomy sport keys */
  "snow - snowboard": "Snowboard",
  "snow-snowboard": "Snowboard",
  "snow/snowboard": "Snowboard",
  snowboarding: "Snowboard",
  "snow - ski": "Ski",
  "snow-ski": "Ski",
  "snow/ski": "Ski",
};

/**
 * Resolve athlete/roster sport string to canonical taxonomy sport (for ENDEMIC lookups).
 */
export function resolveSportToCanonical(sport: string | null): string | null {
  const s = sport?.trim() || "";
  if (!s) return null;
  // Treat en dash, em dash, minus sign like hyphen so "Snow – Snowboard" matches roster aliases
  const key = s
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*\/\s*/g, "/");

  if (SPORT_ALIAS_TO_CANONICAL[key]) return SPORT_ALIAS_TO_CANONICAL[key];

  const haystack = key;
  const twoWheelHints =
    /(?:^|[\s/\-])(two[\s-]wheel|2[\s-]?wheel|supercross|motocross|\bmoto\b|dirt[\s-]?bike|off[\s-]?road[\s-]?moto|\bmx\b)/.test(
      haystack
    );
  const fourWheelHints =
    /\b(four[\s-]wheel|4[\s-]?wheel|nascar|indycar|indy[\s-]car|formula[\s-]?1|\bf1\b|stock[\s-]?car|cup[\s-]series|sport[s]?car|road[\s-]racing|gt[\s-]racing|circuit[\s-]racing|monster[\s-]?truck)\b/.test(
      haystack
    );

  if (twoWheelHints && !fourWheelHints) return MOTO_CANONICAL;
  if (fourWheelHints && !twoWheelHints) return RACING_CANONICAL;
  if (twoWheelHints && fourWheelHints) {
    if (/(?:^|[\s/\-])(two[\s-]wheel|2[\s-]?wheel)/.test(haystack)) return MOTO_CANONICAL;
    if (/\b(four[\s-]wheel|4[\s-]?wheel)\b/.test(haystack)) return RACING_CANONICAL;
    return MOTO_CANONICAL;
  }

  const entries = Object.entries(SPORT_ALIAS_TO_CANONICAL)
    .filter(([alias]) => alias !== "motorsports")
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, canonical] of entries) {
    const a = alias.replace(/\s*\/\s*/g, "/");
    if (haystack.includes(a)) return canonical;
    if (a.length >= 4 && a.includes(haystack) && haystack.length >= 4) return canonical;
  }

  if (haystack === "motorsports" || (haystack.includes("motorsports") && !twoWheelHints)) {
    return RACING_CANONICAL;
  }

  return null;
}

/**
 * Sport string to use for taxonomy ENDEMIC queries. Tries exact match first, then alias resolution.
 */
export function sportForTaxonomyEndemicQuery(sport: string | null): string {
  const s = sport?.trim() || "";
  if (!s) return "";
  const canonical = resolveSportToCanonical(s);
  return canonical ?? s;
}

/**
 * Fetch merged taxonomy rows: ENDEMIC for canonical sport + NON_ENDEMIC global. Sorted endemic first, then non-endemic.
 */
export async function fetchTaxonomyNodesForSport(
  sport: string | null
): Promise<TaxonomyNodeRow[]> {
  const supabase = await createServerClient();
  const endemicSport = sportForTaxonomyEndemicQuery(sport);
  if (!endemicSport) return [];

  const [endemicRes, globalRes] = await Promise.all([
    supabase
      .from("sponsorship_taxonomies")
      .select("id, sport, tier, category, sort_order")
      .eq("sport", endemicSport)
      .eq("tier", "ENDEMIC")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("sponsorship_taxonomies")
      .select("id, sport, tier, category, sort_order")
      .eq("sport", TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT)
      .eq("tier", "NON_ENDEMIC")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const endemicRows = (endemicRes.data ?? []) as TaxonomyNodeRow[];
  const globalRows = (globalRes.data ?? []) as TaxonomyNodeRow[];

  if (globalRows.length > 0) {
    return [...endemicRows, ...globalRows];
  }

  const { data: legacyNon } = await supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order")
    .eq("sport", endemicSport)
    .eq("tier", "NON_ENDEMIC")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const legacy = (legacyNon ?? []) as TaxonomyNodeRow[];
  return [...endemicRows, ...legacy];
}

/**
 * Fetch taxonomy for a sport from DB. Returns { endemic, nonEndemic, all }.
 */
export async function getTaxonomyBySport(sport: string | null): Promise<TaxonomyBySport> {
  const nodes = await fetchTaxonomyNodesForSport(sport);
  if (!nodes.length) {
    return { endemic: [], nonEndemic: [], all: [] };
  }

  const endemic: string[] = [];
  const nonEndemic: string[] = [];
  for (const r of nodes) {
    if (r.tier === "ENDEMIC") endemic.push(r.category);
    else if (r.tier === "NON_ENDEMIC") nonEndemic.push(r.category);
  }
  const all = [...endemic, ...nonEndemic];
  return { endemic, nonEndemic, all };
}

/**
 * Resolve incoming category string to exact taxonomy category for a sport (case/whitespace-insensitive).
 */
export async function resolveCategoryToTaxonomy(
  sport: string | null,
  incomingCategory: string
): Promise<string | null> {
  const { all } = await getTaxonomyBySport(sport);
  const normalized = normalizeCategoryForMatch(incomingCategory);
  if (!normalized) return null;
  const found = all.find((c) => normalizeCategoryForMatch(c) === normalized);
  return found ?? null;
}

/**
 * Check if a sport's taxonomy includes "Unknown" (for import fallback).
 */
export async function taxonomyHasUnknown(sport: string | null): Promise<boolean> {
  const { nonEndemic } = await getTaxonomyBySport(sport);
  return nonEndemic.some((c) => normalizeCategoryForMatch(c) === "unknown");
}
