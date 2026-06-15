/**
 * Sport-specific sponsorship taxonomies.
 * ENDEMIC rows are per sport; NON_ENDEMIC rows live under TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT (single list for all sports).
 */

import { createServerClient } from "@/lib/supabase/server";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";
import {
  resolveSportToCanonical,
  sportForTaxonomyEndemicQuery,
} from "@/lib/taxonomy-sport-resolve";

export type TaxonomyBySport = {
  endemic: string[];
  nonEndemic: string[];
  all: string[];
};

export { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT, isAthleteTaxonomySport } from "@/lib/taxonomy-constants";
export { resolveSportToCanonical, sportForTaxonomyEndemicQuery } from "@/lib/taxonomy-sport-resolve";

export type TaxonomyNodeRow = {
  id: string;
  sport: string;
  tier: string;
  category: string;
  sort_order: number;
  parent_id?: string | null;
  is_group?: boolean;
};

/** Normalize category for comparison: lowercase, trim, collapse whitespace. */
export function normalizeCategoryForMatch(cat: string): string {
  return cat
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
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
      .select("id, sport, tier, category, sort_order, parent_id, is_group")
      .eq("sport", endemicSport)
      .eq("tier", "ENDEMIC")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("sponsorship_taxonomies")
      .select("id, sport, tier, category, sort_order, parent_id, is_group")
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
    .select("id, sport, tier, category, sort_order, parent_id, is_group")
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
    if (r.is_group) continue;
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
