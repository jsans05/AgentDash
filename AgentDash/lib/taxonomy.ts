/**
 * Sport-specific sponsorship taxonomies.
 * Categories are tiered: ENDEMIC (sport-specific) vs NON_ENDEMIC (standardized across sports).
 */

import { createServerClient } from "@/lib/supabase/server";

export type TaxonomyBySport = {
  endemic: string[];
  nonEndemic: string[];
  all: string[];
};

/** Normalize category for comparison: lowercase, trim, collapse whitespace. */
export function normalizeCategoryForMatch(cat: string): string {
  return cat
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Map roster/display sport values to canonical taxonomy sport names (sponsorship_taxonomies.sport).
 * Roster may use different labels (e.g. "Motorsports/Two Wheel - Supercross/Motocross") than the taxonomy ("Supercross / Motocross (Moto)").
 */
const SPORT_ALIAS_TO_CANONICAL: Record<string, string> = {
  "motorsports/two wheel - supercross/motocross": "Supercross / Motocross (Moto)",
  "motorsports / two wheel - supercross / motocross": "Supercross / Motocross (Moto)",
  "supercross/motocross": "Supercross / Motocross (Moto)",
  "supercross / motocross (moto)": "Supercross / Motocross (Moto)",
  "supercross": "Supercross / Motocross (Moto)",
  "motocross": "Supercross / Motocross (Moto)",
  "moto": "Supercross / Motocross (Moto)",
  "racing / motorsports": "Racing / Motorsports",
  "racing/motorsports": "Racing / Motorsports",
  "motorsports": "Racing / Motorsports",
  "mountain bike": "Mountain Bike",
  "mountain biking": "Mountain Bike",
  "track & field": "Track & Field",
  "track and field": "Track & Field",
  "outdoor / climbing": "Outdoor / Climbing",
  "outdoor/climbing": "Outdoor / Climbing",
  "lifestyle / broadcast / chef / personality": "Lifestyle / Broadcast / Chef / Personality",
};

/** Resolve athlete/roster sport string to canonical taxonomy sport (for taxonomy lookups). */
export function resolveSportToCanonical(sport: string | null): string | null {
  const s = sport?.trim() || "";
  if (!s) return null;
  const key = s.toLowerCase().replace(/\s+/g, " ").trim();
  if (SPORT_ALIAS_TO_CANONICAL[key]) return SPORT_ALIAS_TO_CANONICAL[key];
  // Partial match: if roster sport contains a canonical fragment, use it
  for (const [alias, canonical] of Object.entries(SPORT_ALIAS_TO_CANONICAL)) {
    if (key.includes(alias) || alias.includes(key)) return canonical;
  }
  return null;
}

/**
 * Sport string to use for taxonomy queries. Tries exact match first, then alias resolution.
 */
function sportForTaxonomyQuery(sport: string | null): string {
  const s = sport?.trim() || "";
  if (!s) return "";
  const canonical = resolveSportToCanonical(s);
  return canonical ?? s;
}

/**
 * Fetch taxonomy for a sport from DB. Returns { endemic, nonEndemic, all }.
 * If sport is null/empty or has no taxonomy, returns empty arrays (caller can fallback to "Unknown" or reject).
 * Uses sport alias map so roster values like "Motorsports/Two Wheel - Supercross/Motocross" resolve to "Supercross / Motocross (Moto)".
 */
export async function getTaxonomyBySport(sport: string | null): Promise<TaxonomyBySport> {
  const supabase = await createServerClient();
  const sportForQuery = sportForTaxonomyQuery(sport);
  if (!sportForQuery) {
    return { endemic: [], nonEndemic: [], all: [] };
  }

  const { data: rows } = await supabase
    .from("sponsorship_taxonomies")
    .select("tier, category, sort_order")
    .eq("sport", sportForQuery)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (!rows?.length) {
    return { endemic: [], nonEndemic: [], all: [] };
  }

  const endemic: string[] = [];
  const nonEndemic: string[] = [];
  for (const r of rows) {
    if (r.tier === "ENDEMIC") endemic.push(r.category);
    else if (r.tier === "NON_ENDEMIC") nonEndemic.push(r.category);
  }
  const all = [...endemic, ...nonEndemic];
  return { endemic, nonEndemic, all };
}

/**
 * Resolve incoming category string to exact taxonomy category for a sport (case/whitespace-insensitive).
 * Returns the exact category string from taxonomy, or null if no match.
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
