/** Minimal card shape for pipeline toolbar filter/sort (matches `PipelineCard` fields used here). */
export type CardForPipelineFilter = {
  id: string;
  company_id: string;
  company_name: string;
  product_category?: string | null;
  pipeline_stage: string;
  updated_at?: string | null;
  potential_athletes?: { athlete_id: string; name?: string; sport?: string | null }[] | null;
};

export type PipelineSortKey = "updated" | "company" | "sport" | "category" | "athlete";

/** Synthetic `athlete_id` used to tag a pipeline card as "general" (not tied to a specific roster athlete). */
export const GENERAL_ATHLETE_ID = "__general__";
export const GENERAL_ATHLETE_NAME = "General";

/** Sentinel values for the category / athlete filter dropdowns. */
export const FILTER_UNCATEGORIZED = "__uncategorized__";
export const FILTER_UNASSIGNED_ATHLETE = "__unassigned__";

export type PipelineFilterOptions = {
  sports: string[];
  categories: string[];
  athletes: { id: string; name: string }[];
};

export function buildFilterOptionsFromCards<T extends CardForPipelineFilter>(cards: readonly T[]): PipelineFilterOptions {
  const sports = new Set<string>();
  const categories = new Set<string>();
  const athletes: { id: string; name: string }[] = [];
  const seenAth = new Set<string>();
  for (const c of cards) {
    if (c.product_category?.trim()) categories.add(c.product_category.trim());
    for (const p of c.potential_athletes ?? []) {
      if (p.sport?.trim()) sports.add(p.sport.trim());
      if (p.athlete_id && !seenAth.has(p.athlete_id)) {
        seenAth.add(p.athlete_id);
        athletes.push({ id: p.athlete_id, name: (p.name ?? "").trim() || "Athlete" });
      }
    }
  }
  return {
    sports: [...sports].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    categories: [...categories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    athletes: athletes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  };
}

export function filterPipelineCards<T extends CardForPipelineFilter>(
  cards: readonly T[],
  filters: { filterSport: string; filterCategory: string; filterAthleteId: string }
): T[] {
  const { filterSport, filterCategory, filterAthleteId } = filters;
  const hasAny = Boolean(filterSport || filterCategory || filterAthleteId);
  if (!hasAny) return [...cards];
  return cards.filter((c) => {
    if (filterSport) {
      const ok = (c.potential_athletes ?? []).some((p) => (p.sport ?? "").trim() === filterSport);
      if (!ok) return false;
    }
    if (filterCategory) {
      const cat = (c.product_category ?? "").trim();
      if (filterCategory === FILTER_UNCATEGORIZED) {
        if (cat !== "") return false;
      } else if (cat !== filterCategory) {
        return false;
      }
    }
    if (filterAthleteId) {
      if (filterAthleteId === FILTER_UNASSIGNED_ATHLETE) {
        const list = c.potential_athletes ?? [];
        if (list.length > 0) return false;
      } else {
        const ok = (c.potential_athletes ?? []).some((p) => p.athlete_id === filterAthleteId);
        if (!ok) return false;
      }
    }
    return true;
  });
}

export function primarySortSport(card: CardForPipelineFilter): string {
  const sports = (card.potential_athletes ?? [])
    .map((p) => (p.sport ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return sports[0] ?? "\uffff";
}

export function primaryAthleteName(card: CardForPipelineFilter): string {
  const names = (card.potential_athletes ?? [])
    .map((p) => (p.name ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return names[0] ?? "\uffff";
}

export function comparePipelineCards(
  a: CardForPipelineFilter,
  b: CardForPipelineFilter,
  sortKey: PipelineSortKey
): number {
  switch (sortKey) {
    case "updated": {
      const ta = new Date(a.updated_at ?? 0).getTime();
      const tb = new Date(b.updated_at ?? 0).getTime();
      return tb - ta;
    }
    case "company":
      return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" });
    case "sport":
      return primarySortSport(a).localeCompare(primarySortSport(b), undefined, { sensitivity: "base" });
    case "category": {
      const ca = (a.product_category ?? "\uffff").toLowerCase();
      const cb = (b.product_category ?? "\uffff").toLowerCase();
      return ca.localeCompare(cb);
    }
    case "athlete":
      return primaryAthleteName(a).localeCompare(primaryAthleteName(b), undefined, { sensitivity: "base" });
    default:
      return 0;
  }
}
