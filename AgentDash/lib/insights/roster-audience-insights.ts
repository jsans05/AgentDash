import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAudiencePercentFraction } from "@/lib/athlete-data";
import {
  canonicalInterestByNormalized,
  industryInterestMap,
  type IndustryInterestKey,
} from "@/lib/industry-interest-map";
import type { Profile } from "@/lib/supabase/types";

const PAGE_SIZE = 1000;

export type PivotDimension = "Interests" | "Brands" | "Combined_Age" | "Gender" | "Countries";

export const PIVOT_DIMENSIONS: PivotDimension[] = [
  "Interests",
  "Brands",
  "Combined_Age",
  "Gender",
  "Countries",
];

export type AudienceCountRow = {
  name: string;
  audience_count: number;
  athlete_count: number;
};

export type ReachBySportRow = {
  sport: string;
  total_followers: number;
  athlete_count: number;
};

export type SportIndustryEntry = {
  industry_key: Exclude<IndustryInterestKey, null>;
  industry_label: string;
  audience_count: number;
};

export type SportIndustryCoverageRow = {
  sport: string;
  athlete_count: number;
  industries: SportIndustryEntry[];
};

export type PivotCell = {
  count: number;
  athlete_count: number;
};

export type PivotCube = {
  sports: string[];
  columnsByDimension: Record<PivotDimension, string[]>;
  bySport: Record<string, Record<PivotDimension, Record<string, PivotCell>>>;
};

export type RosterAudienceInsights = {
  total_reach: number;
  total_athletes: number;
  athletes_with_audience_count: number;
  gender: AudienceCountRow[];
  age: AudienceCountRow[];
  countries: AudienceCountRow[];
  interests: AudienceCountRow[];
  brands: AudienceCountRow[];
  reach_by_sport: ReachBySportRow[];
  sport_industry_coverage: SportIndustryCoverageRow[];
  pivot: PivotCube;
};

const INDUSTRY_LABELS: Record<Exclude<IndustryInterestKey, null>, string> = {
  fitness: "Fitness & Wellness",
  apparel: "Apparel & Fashion",
  camera: "Camera & Tech",
  beverage: "Beverage",
  automotive: "Automotive",
  gaming: "Gaming",
  beauty: "Beauty",
  travel: "Travel & Tourism",
  food: "Food & Restaurant",
  tech: "Technology",
  finance: "Finance",
  family: "Family & Parenting",
  entertainment: "Entertainment & Media",
  pets: "Pets",
};

const PIVOT_CATEGORY_MAP: Record<PivotDimension, string> = {
  Interests: "Interests",
  Brands: "Brands",
  Combined_Age: "Combined_Age",
  Gender: "Gender",
  Countries: "Countries",
};

const AGGREGATE_CATEGORIES = [
  "Gender",
  "Combined_Age",
  "Countries",
  "Interests",
  "Brands",
] as const;

type AudienceDbRow = {
  athlete_id: string;
  audience_category: string;
  audience_name: string;
  ig_audience_count: number | null;
  ig_audience_percent: number | null;
  current_ig_following: number | null;
};

function effectiveAudienceCount(
  igAudienceCount: number | null | undefined,
  igAudiencePercentRaw: number | null | undefined,
  igFollowingFromRow: number | null | undefined,
  igFollowingFromSocial: number
): number {
  const following =
    igFollowingFromRow != null && Number(igFollowingFromRow) > 0
      ? Math.floor(Number(igFollowingFromRow))
      : Math.max(0, Math.floor(Number(igFollowingFromSocial) || 0));
  const count = Math.floor(Number(igAudienceCount ?? 0));
  if (Number.isFinite(count) && count > 0) return count;
  const pct = resolveAudiencePercentFraction(
    Number(igAudiencePercentRaw ?? 0),
    count,
    following > 0 ? following : null
  );
  if (pct > 0 && following > 0) return Math.round(pct * following);
  return 0;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalizeAudienceName(category: string, name: string): string | null {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  if (category === "Interests") {
    const canonical = canonicalInterestByNormalized[normalizeLabel(trimmed)];
    return canonical ?? trimmed;
  }
  return trimmed;
}

async function fetchDistinctAthleteIdsWithAudience(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select("athlete_id")
      .order("athlete_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    for (const row of batch) {
      const id = (row as { athlete_id?: string }).athlete_id;
      if (id) ids.add(id);
    }
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return ids;
}

async function fetchAllAudienceRows(supabase: SupabaseClient): Promise<AudienceDbRow[]> {
  const all: AudienceDbRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select(
        "athlete_id, audience_category, audience_name, ig_audience_count, ig_audience_percent, current_ig_following"
      )
      .in("audience_category", [...AGGREGATE_CATEGORIES])
      .order("athlete_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as AudienceDbRow[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function addToAggregate(
  map: Map<string, { count: number; athletes: Set<string> }>,
  name: string,
  athleteId: string,
  count: number
) {
  if (count <= 0) return;
  const prev = map.get(name) ?? { count: 0, athletes: new Set<string>() };
  prev.count += count;
  prev.athletes.add(athleteId);
  map.set(name, prev);
}

function mapToSortedRows(map: Map<string, { count: number; athletes: Set<string> }>, limit?: number): AudienceCountRow[] {
  const rows = [...map.entries()]
    .map(([name, v]) => ({
      name,
      audience_count: v.count,
      athlete_count: v.athletes.size,
    }))
    .sort((a, b) => b.audience_count - a.audience_count);
  return limit ? rows.slice(0, limit) : rows;
}

function addPivotCell(
  cube: Record<string, Record<PivotDimension, Record<string, PivotCell>>>,
  sport: string,
  dimension: PivotDimension,
  name: string,
  _athleteId: string,
  count: number
) {
  if (count <= 0) return;
  if (!cube[sport]) cube[sport] = {} as Record<PivotDimension, Record<string, PivotCell>>;
  if (!cube[sport][dimension]) cube[sport][dimension] = {};
  const cell = cube[sport][dimension][name] ?? { count: 0, athlete_count: 0 };
  cell.count += count;
  cube[sport][dimension][name] = cell;
}

function finalizePivotAthleteCounts(
  cube: Record<string, Record<PivotDimension, Record<string, PivotCell>>>,
  athleteSets: Map<string, Set<string>>
) {
  for (const [key, athletes] of athleteSets) {
    const [sport, dimension, name] = key.split("|||") as [string, PivotDimension, string];
    const cell = cube[sport]?.[dimension]?.[name];
    if (cell) cell.athlete_count = athletes.size;
  }
}

function buildColumnNames(
  cube: Record<string, Record<PivotDimension, Record<string, PivotCell>>>,
  sports: string[],
  dimension: PivotDimension,
  maxColumns: number
): string[] {
  const totals = new Map<string, number>();
  for (const sport of sports) {
    const dimData = cube[sport]?.[dimension] ?? {};
    for (const [name, cell] of Object.entries(dimData)) {
      totals.set(name, (totals.get(name) ?? 0) + cell.count);
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (sorted.length <= maxColumns) return sorted;
  return [...sorted.slice(0, maxColumns - 1), "Other"];
}

export async function getRosterAudienceInsights(
  supabase: SupabaseClient,
  _profile: Profile
): Promise<RosterAudienceInsights> {
  const [athletesRes, socialRes, athletesWithAnyAudienceRow] = await Promise.all([
    supabase.from("athletes").select("athlete_id, sport"),
    supabase.from("athlete_social_data").select("athlete_id, total_followers, ig_followers"),
    fetchDistinctAthleteIdsWithAudience(supabase),
  ]);

  const athletes = athletesRes.data ?? [];
  const sportByAthlete = new Map(
    athletes.map((a) => [a.athlete_id, (a.sport?.trim() || "Unknown") as string])
  );

  const igFollowersByAthlete = new Map<string, number>();
  let total_reach = 0;
  for (const row of socialRes.data ?? []) {
    const id = row.athlete_id;
    const total = Number(row.total_followers) || 0;
    total_reach += total;
    const ig = Number(row.ig_followers ?? 0);
    igFollowersByAthlete.set(id, ig > 0 ? ig : total);
  }

  const genderMap = new Map<string, { count: number; athletes: Set<string> }>();
  const ageMap = new Map<string, { count: number; athletes: Set<string> }>();
  const countryMap = new Map<string, { count: number; athletes: Set<string> }>();
  const interestMap = new Map<string, { count: number; athletes: Set<string> }>();
  const brandMap = new Map<string, { count: number; athletes: Set<string> }>();

  const pivotCube: Record<string, Record<PivotDimension, Record<string, PivotCell>>> = {};
  const pivotAthleteSets = new Map<string, Set<string>>();

  const sportInterestTotals = new Map<string, Map<string, number>>();
  const sportAthleteCounts = new Map<string, Set<string>>();

  const audienceRows = await fetchAllAudienceRows(supabase);

  for (const row of audienceRows) {
    const athleteId = row.athlete_id;
    const sport = sportByAthlete.get(athleteId) ?? "Unknown";
    const category = row.audience_category;
    const canonicalName = canonicalizeAudienceName(category, row.audience_name);
    if (!canonicalName) continue;

    const igBase = igFollowersByAthlete.get(athleteId) ?? 0;
    const count = effectiveAudienceCount(
      row.ig_audience_count,
      row.ig_audience_percent,
      row.current_ig_following,
      igBase
    );
    if (count <= 0) continue;
    const sportAthletes = sportAthleteCounts.get(sport) ?? new Set<string>();
    sportAthletes.add(athleteId);
    sportAthleteCounts.set(sport, sportAthletes);

    if (category === "Gender") addToAggregate(genderMap, canonicalName, athleteId, count);
    if (category === "Combined_Age") addToAggregate(ageMap, canonicalName, athleteId, count);
    if (category === "Countries") addToAggregate(countryMap, canonicalName, athleteId, count);
    if (category === "Interests") {
      addToAggregate(interestMap, canonicalName, athleteId, count);
      const sportInterests = sportInterestTotals.get(sport) ?? new Map<string, number>();
      sportInterests.set(canonicalName, (sportInterests.get(canonicalName) ?? 0) + count);
      sportInterestTotals.set(sport, sportInterests);
    }
    if (category === "Brands") addToAggregate(brandMap, canonicalName, athleteId, count);

    const pivotDim = Object.entries(PIVOT_CATEGORY_MAP).find(([, cat]) => cat === category)?.[0] as
      | PivotDimension
      | undefined;
    if (pivotDim) {
      addPivotCell(pivotCube, sport, pivotDim, canonicalName, athleteId, count);
      const cellKey = `${sport}|||${pivotDim}|||${canonicalName}`;
      const set = pivotAthleteSets.get(cellKey) ?? new Set<string>();
      set.add(athleteId);
      pivotAthleteSets.set(cellKey, set);
    }
  }

  finalizePivotAthleteCounts(pivotCube, pivotAthleteSets);

  const reachBySportMap = new Map<string, { total: number; count: number }>();
  for (const row of socialRes.data ?? []) {
    const sport = sportByAthlete.get(row.athlete_id) ?? "Unknown";
    const prev = reachBySportMap.get(sport) ?? { total: 0, count: 0 };
    reachBySportMap.set(sport, {
      total: prev.total + (Number(row.total_followers) || 0),
      count: prev.count + 1,
    });
  }

  const reach_by_sport = [...reachBySportMap.entries()]
    .map(([sport, v]) => ({
      sport,
      total_followers: v.total,
      athlete_count: v.count,
    }))
    .sort((a, b) => b.total_followers - a.total_followers);

  const industryKeys = Object.keys(industryInterestMap) as Array<Exclude<IndustryInterestKey, null>>;
  const sport_industry_coverage: SportIndustryCoverageRow[] = [...sportInterestTotals.entries()]
    .map(([sport, interestTotals]) => {
      const industries: SportIndustryEntry[] = industryKeys
        .map((industry_key) => {
          const mappedInterests = industryInterestMap[industry_key];
          let audience_count = 0;
          for (const interest of mappedInterests) {
            audience_count += interestTotals.get(interest) ?? 0;
          }
          return {
            industry_key,
            industry_label: INDUSTRY_LABELS[industry_key],
            audience_count,
          };
        })
        .filter((row) => row.audience_count > 0)
        .sort((a, b) => b.audience_count - a.audience_count);

      return {
        sport,
        athlete_count: sportAthleteCounts.get(sport)?.size ?? 0,
        industries,
      };
    })
    .filter((row) => row.industries.length > 0)
    .sort((a, b) => {
      const aTop = a.industries[0]?.audience_count ?? 0;
      const bTop = b.industries[0]?.audience_count ?? 0;
      return bTop - aTop;
    });

  const sports = [...new Set([...sportByAthlete.values()])].sort((a, b) => a.localeCompare(b));
  const columnsByDimension = {} as Record<PivotDimension, string[]>;
  for (const dim of PIVOT_DIMENSIONS) {
    columnsByDimension[dim] = buildColumnNames(pivotCube, sports, dim, dim === "Interests" ? 12 : 10);
  }

  return {
    total_reach,
    total_athletes: athletes.length,
    athletes_with_audience_count: athletesWithAnyAudienceRow.size,
    gender: mapToSortedRows(genderMap),
    age: mapToSortedRows(ageMap),
    countries: mapToSortedRows(countryMap, 10),
    interests: mapToSortedRows(interestMap, 15),
    brands: mapToSortedRows(brandMap, 20),
    reach_by_sport,
    sport_industry_coverage,
    pivot: {
      sports,
      columnsByDimension,
      bySport: pivotCube,
    },
  };
}
