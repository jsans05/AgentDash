import type { SupabaseClient } from "@supabase/supabase-js";
import { GENERAL_ATHLETE_ID } from "@/lib/crm/pipeline-card-filter-sort";

type PaEntry = { athlete_id: string; name?: string; sport?: string | null };

/** UUID v4-ish matcher — `athletes.athlete_id` is a UUID column, so non-UUID ids (e.g. our synthetic "General") must be filtered before querying. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetches `sport` from `athletes` for each pipeline card's `potential_athletes` (batch).
 */
export async function enrichPipelineCardsWithAthleteSports(
  supabase: SupabaseClient,
  cards: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = new Set<string>();
  for (const c of cards) {
    const pa = c.potential_athletes;
    if (!Array.isArray(pa)) continue;
    for (const p of pa) {
      if (p && typeof p === "object" && "athlete_id" in p) {
        const id = String((p as { athlete_id: unknown }).athlete_id ?? "");
        if (id && id !== GENERAL_ATHLETE_ID && UUID_RE.test(id)) ids.add(id);
      }
    }
  }
  if (ids.size === 0) return cards;

  const { data: rows, error } = await supabase
    .from("athletes")
    .select("athlete_id, sport")
    .in("athlete_id", [...ids]);

  if (error || !rows?.length) return cards;

  const sportById = new Map<string, string | null>();
  for (const r of rows as { athlete_id: string; sport: string | null }[]) {
    sportById.set(r.athlete_id, r.sport ?? null);
  }

  return cards.map((c) => {
    const pa = c.potential_athletes;
    if (!Array.isArray(pa) || pa.length === 0) return c;
    const enriched: PaEntry[] = pa.map((raw) => {
      const p = raw as PaEntry;
      return {
        ...p,
        sport: sportById.get(p.athlete_id) ?? null,
      };
    });
    return { ...c, potential_athletes: enriched };
  });
}
