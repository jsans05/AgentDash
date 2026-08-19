import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockChartPayload } from "@/lib/market-data/stock-display";

export type CupDriverRow = {
  id: string;
  season_year: number;
  position: number | null;
  car_no: string;
  driver_name: string;
  manufacturer: string | null;
  owner_name: string | null;
  team_name: string | null;
  owner_entity_key: string | null;
  team_website_url: string | null;
  nascar_team_page_url: string | null;
  points: number | null;
  wins: number | null;
  top_5: number | null;
  top_10: number | null;
  scraped_at: string | null;
};

export type TeamSponsorRow = {
  id: string;
  entity_key: string;
  owner_name: string;
  team_name: string | null;
  company_name: string;
  company_name_normalized: string;
  display_name: string;
  sponsor_url: string | null;
  scraped_at: string | null;
};

export type VenueRow = {
  entity_key: string;
  name: string;
  sport_type: string | null;
  sponsor_page_url: string;
};

export type VenueSponsorRow = {
  id: string;
  entity_key: string;
  venue_name: string;
  sport_type: string | null;
  company_name: string;
  company_name_normalized: string;
  display_name: string;
  sponsor_url: string | null;
  scraped_at: string | null;
};

export type BrandTeamPlacement = {
  id: string;
  entity_key: string;
  owner_name: string;
  team_name: string | null;
  sponsor_url: string | null;
};

export type BrandVenuePlacement = {
  id: string;
  entity_key: string;
  venue_name: string;
  sponsor_url: string | null;
};

export type AggregatedBrand = {
  key: string;
  displayName: string;
  teamPlacements: BrandTeamPlacement[];
  venuePlacements: BrandVenuePlacement[];
};

export type BrandEnrichmentRow = {
  company_name_normalized: string;
  display_name: string;
  domain: string | null;
  apollo_organization_id: string | null;
  annual_revenue: number | null;
  annual_revenue_printed: string | null;
  total_funding: number | null;
  total_funding_printed: string | null;
  latest_funding_stage: string | null;
  latest_funding_round_date: string | null;
  funding_events: Array<{
    date?: string;
    type?: string;
    amount?: string;
    investors?: string;
    currency?: string;
  }>;
  estimated_num_employees: number | null;
  industry: string | null;
  headcount_six_month_growth: number | null;
  headcount_twelve_month_growth: number | null;
  headcount_twenty_four_month_growth: number | null;
  departmental_head_count: Record<string, number> | null;
  match_confidence: string | null;
  match_notes: string | null;
  ticker: string | null;
  stock_symbol: string | null;
  stock_symbol_override: string | null;
  exchange: string | null;
  stock_currency: string | null;
  market_cap: number | null;
  share_price: number | null;
  share_price_change_pct: number | null;
  stock_change_5d_pct: number | null;
  stock_change_3m_pct: number | null;
  stock_change_12m_pct: number | null;
  stock_52w_high: number | null;
  stock_52w_low: number | null;
  stock_beta: number | null;
  stock_sparkline: StockChartPayload | null;
  market_data_as_of: string | null;
  open_jobs_count: number | null;
  open_jobs_source: string | null;
  open_jobs_as_of: string | null;
  instagram_handle: string | null;
  facebook_page_url: string | null;
  meta_page_id: string | null;
  meta_ads_library_url: string | null;
  meta_ads_latest_start: string | null;
  meta_ads_active_count: number | null;
  meta_ads_status: string | null;
  meta_ads_as_of: string | null;
  spend_readiness_score: number | null;
  spend_readiness_label: string | null;
  news_articles: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string | null;
    published_at: string | null;
    event_categories: string[];
  }>;
  enriched_at: string;
  enriched_by: string | null;
};

export type MarketIntelData = {
  cup_drivers: CupDriverRow[];
  team_sponsors: TeamSponsorRow[];
  venues: VenueRow[];
  venue_sponsors: VenueSponsorRow[];
  brand_enrichments: BrandEnrichmentRow[];
  last_sync_at: string | null;
};

export async function getMarketIntelData(
  supabase: SupabaseClient
): Promise<MarketIntelData> {
  const [driversRes, teamSponsorsRes, venuesRes, venueSponsorsRes, enrichmentsRes, runsRes] =
    await Promise.all([
      supabase
        .from("market_intel_cup_drivers")
        .select(
          "id, season_year, position, car_no, driver_name, manufacturer, owner_name, team_name, owner_entity_key, team_website_url, nascar_team_page_url, points, wins, top_5, top_10, scraped_at"
        )
        .order("position", { ascending: true }),
      supabase
        .from("market_intel_team_sponsors")
        .select(
          "id, entity_key, owner_name, team_name, company_name, company_name_normalized, display_name, sponsor_url, scraped_at"
        )
        .order("owner_name", { ascending: true })
        .order("company_name", { ascending: true }),
      supabase
        .from("market_intel_venues")
        .select("entity_key, name, sport_type, sponsor_page_url")
        .neq("sport_type", "mlb")
        .order("name", { ascending: true }),
      supabase
        .from("market_intel_venue_sponsors")
        .select(
          "id, entity_key, venue_name, sport_type, company_name, company_name_normalized, display_name, sponsor_url, scraped_at"
        )
        .neq("sport_type", "mlb")
        .order("venue_name", { ascending: true })
        .order("company_name", { ascending: true }),
      supabase.from("market_intel_brand_enrichment").select("*"),
      supabase
        .from("market_intel_scrape_runs")
        .select("finished_at")
        .order("finished_at", { ascending: false })
        .limit(1),
    ]);

  if (driversRes.error) throw driversRes.error;
  if (teamSponsorsRes.error) throw teamSponsorsRes.error;
  if (venuesRes.error) throw venuesRes.error;
  if (venueSponsorsRes.error) throw venueSponsorsRes.error;
  if (enrichmentsRes.error) throw enrichmentsRes.error;

  return {
    cup_drivers: (driversRes.data ?? []) as CupDriverRow[],
    team_sponsors: (teamSponsorsRes.data ?? []) as TeamSponsorRow[],
    venues: (venuesRes.data ?? []) as VenueRow[],
    venue_sponsors: (venueSponsorsRes.data ?? []) as VenueSponsorRow[],
    brand_enrichments: (enrichmentsRes.data ?? []) as BrandEnrichmentRow[],
    last_sync_at: runsRes.data?.[0]?.finished_at ?? null,
  };
}

export function brandEnrichmentsByKey(
  rows: BrandEnrichmentRow[]
): Record<string, BrandEnrichmentRow> {
  const map: Record<string, BrandEnrichmentRow> = {};
  for (const row of rows) {
    map[row.company_name_normalized] = row;
  }
  return map;
}

export function groupTeamSponsorsByOwner(
  sponsors: TeamSponsorRow[]
): Map<string, TeamSponsorRow[]> {
  const map = new Map<string, TeamSponsorRow[]>();
  for (const row of sponsors) {
    const key = row.owner_name;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

export function groupVenueSponsorsByVenue(
  sponsors: VenueSponsorRow[]
): Map<string, VenueSponsorRow[]> {
  const map = new Map<string, VenueSponsorRow[]>();
  for (const row of sponsors) {
    const key = row.entity_key;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function brandKey(row: {
  company_name_normalized?: string | null;
  company_name: string;
}): string {
  const normalized = row.company_name_normalized?.trim();
  if (normalized) return normalized;
  return row.company_name.trim().toLowerCase();
}

function pickBestDisplayName(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return "Unknown";
  return unique.sort((a, b) => b.length - a.length)[0];
}

export function aggregateBrands(
  teamSponsors: TeamSponsorRow[],
  venueSponsors: VenueSponsorRow[]
): AggregatedBrand[] {
  const map = new Map<
    string,
    {
      displayNames: string[];
      team: BrandTeamPlacement[];
      venue: BrandVenuePlacement[];
    }
  >();

  for (const row of teamSponsors) {
    const key = brandKey(row);
    const entry = map.get(key) ?? { displayNames: [], team: [], venue: [] };
    entry.displayNames.push(row.display_name || row.company_name);
    entry.team.push({
      id: row.id,
      entity_key: row.entity_key,
      owner_name: row.owner_name,
      team_name: row.team_name,
      sponsor_url: row.sponsor_url,
    });
    map.set(key, entry);
  }

  for (const row of venueSponsors) {
    const key = brandKey(row);
    const entry = map.get(key) ?? { displayNames: [], team: [], venue: [] };
    entry.displayNames.push(row.display_name || row.company_name);
    entry.venue.push({
      id: row.id,
      entity_key: row.entity_key,
      venue_name: row.venue_name,
      sponsor_url: row.sponsor_url,
    });
    map.set(key, entry);
  }

  return [...map.entries()]
    .map(([key, entry]) => ({
      key,
      displayName: pickBestDisplayName(entry.displayNames),
      teamPlacements: entry.team,
      venuePlacements: entry.venue,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function brandPlacementCount(brand: AggregatedBrand): number {
  return brand.teamPlacements.length + brand.venuePlacements.length;
}

export type BrandSortKey =
  | "brand-asc"
  | "brand-desc"
  | "placements-asc"
  | "placements-desc"
  | "revenue-desc"
  | "revenue-asc"
  | "employees-desc"
  | "employees-asc"
  | "funding-desc"
  | "funding-asc"
  | "growth12-desc"
  | "growth12-asc";

export type RevenueBucket =
  | "unknown"
  | "under_10m"
  | "10m_50m"
  | "50m_250m"
  | "250m_1b"
  | "over_1b";

export type EmployeeBucket =
  | "unknown"
  | "under_50"
  | "50_200"
  | "200_1k"
  | "1k_5k"
  | "over_5k";

export type EnrichmentFilter = "all" | "enriched" | "not_enriched";

export type PlacementSourceFilter = "all" | "teams_only" | "venues_only" | "both";

export type PlacementCountBucket = "1" | "2_3" | "4_9" | "10_plus";

export type BrandFilters = {
  enrichment: EnrichmentFilter;
  revenueBuckets: RevenueBucket[];
  employeeBuckets: EmployeeBucket[];
  fundingStages: string[];
  placementSource: PlacementSourceFilter;
  placementCountBuckets: PlacementCountBucket[];
  sportTypes: string[];
  teamOwners: string[];
  venueKeys: string[];
};

export const DEFAULT_BRAND_FILTERS: BrandFilters = {
  enrichment: "all",
  revenueBuckets: [],
  employeeBuckets: [],
  fundingStages: [],
  placementSource: "all",
  placementCountBuckets: [],
  sportTypes: [],
  teamOwners: [],
  venueKeys: [],
};

export function revenueBucketForBrand(
  enrichment: BrandEnrichmentRow | undefined
): RevenueBucket {
  const rev = enrichment?.annual_revenue;
  if (rev == null) return "unknown";
  if (rev < 10_000_000) return "under_10m";
  if (rev < 50_000_000) return "10m_50m";
  if (rev < 250_000_000) return "50m_250m";
  if (rev < 1_000_000_000) return "250m_1b";
  return "over_1b";
}

export function employeeBucketForBrand(
  enrichment: BrandEnrichmentRow | undefined
): EmployeeBucket {
  const employees = enrichment?.estimated_num_employees;
  if (employees == null) return "unknown";
  if (employees < 50) return "under_50";
  if (employees < 200) return "50_200";
  if (employees < 1000) return "200_1k";
  if (employees < 5000) return "1k_5k";
  return "over_5k";
}

export function brandSportTypes(
  brand: AggregatedBrand,
  venueSportByKey: Map<string, string | null>
): string[] {
  const sports = new Set<string>();
  if (brand.teamPlacements.length > 0) sports.add("nascar");
  for (const placement of brand.venuePlacements) {
    const sport = venueSportByKey.get(placement.entity_key);
    if (sport) sports.add(sport.toLowerCase());
  }
  return [...sports];
}

export function brandQualifiesForAutoFirmographics(
  brand: AggregatedBrand,
  venueSportByKey: Map<string, string | null>
): boolean {
  return (
    brandPlacementCount(brand) > 3 ||
    brandSportTypes(brand, venueSportByKey).length >= 2
  );
}

export function hasBrandApolloFirmographics(
  enrichment: BrandEnrichmentRow | undefined
): boolean {
  if (!enrichment) return false;
  return (
    Boolean(enrichment.apollo_organization_id) ||
    enrichment.annual_revenue != null ||
    enrichment.estimated_num_employees != null
  );
}

function placementCountMatchesBucket(
  count: number,
  bucket: PlacementCountBucket
): boolean {
  switch (bucket) {
    case "1":
      return count === 1;
    case "2_3":
      return count >= 2 && count <= 3;
    case "4_9":
      return count >= 4 && count <= 9;
    case "10_plus":
      return count >= 10;
    default:
      return false;
  }
}

function numericOrNegInfinity(value: number | null | undefined): number {
  return value == null || Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

export function sortBrands(
  brands: AggregatedBrand[],
  sort: BrandSortKey,
  enrichmentByKey: Record<string, BrandEnrichmentRow> = {}
): AggregatedBrand[] {
  const sorted = [...brands];
  switch (sort) {
    case "brand-asc":
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
      break;
    case "brand-desc":
      sorted.sort((a, b) => b.displayName.localeCompare(a.displayName));
      break;
    case "placements-asc":
      sorted.sort(
        (a, b) =>
          brandPlacementCount(a) - brandPlacementCount(b) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "placements-desc":
      sorted.sort(
        (a, b) =>
          brandPlacementCount(b) - brandPlacementCount(a) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "revenue-desc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[b.key]?.annual_revenue) -
            numericOrNegInfinity(enrichmentByKey[a.key]?.annual_revenue) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "revenue-asc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[a.key]?.annual_revenue) -
            numericOrNegInfinity(enrichmentByKey[b.key]?.annual_revenue) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "employees-desc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[b.key]?.estimated_num_employees) -
            numericOrNegInfinity(enrichmentByKey[a.key]?.estimated_num_employees) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "employees-asc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[a.key]?.estimated_num_employees) -
            numericOrNegInfinity(enrichmentByKey[b.key]?.estimated_num_employees) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "funding-desc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[b.key]?.total_funding) -
            numericOrNegInfinity(enrichmentByKey[a.key]?.total_funding) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "funding-asc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[a.key]?.total_funding) -
            numericOrNegInfinity(enrichmentByKey[b.key]?.total_funding) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "growth12-desc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[b.key]?.headcount_twelve_month_growth) -
            numericOrNegInfinity(enrichmentByKey[a.key]?.headcount_twelve_month_growth) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
    case "growth12-asc":
      sorted.sort(
        (a, b) =>
          numericOrNegInfinity(enrichmentByKey[a.key]?.headcount_twelve_month_growth) -
            numericOrNegInfinity(enrichmentByKey[b.key]?.headcount_twelve_month_growth) ||
          a.displayName.localeCompare(b.displayName)
      );
      break;
  }
  return sorted;
}

export function filterBrands(
  brands: AggregatedBrand[],
  query: string,
  cupDrivers: CupDriverRow[],
  filters: BrandFilters = DEFAULT_BRAND_FILTERS,
  enrichmentByKey: Record<string, BrandEnrichmentRow> = {},
  venueSportByKey: Map<string, string | null> = new Map()
): AggregatedBrand[] {
  const q = query.trim().toLowerCase();

  const matchingOwnerNames = new Set<string>();
  if (q) {
    for (const driver of cupDrivers) {
      const owner = driver.owner_name?.trim();
      if (
        driver.driver_name.toLowerCase().includes(q) ||
        driver.car_no.toLowerCase().includes(q) ||
        (owner?.toLowerCase().includes(q) ?? false)
      ) {
        if (owner) matchingOwnerNames.add(owner.toLowerCase());
      }
    }
  }

  return brands.filter((brand) => {
    const enrichment = enrichmentByKey[brand.key];

    if (filters.enrichment === "enriched" && !enrichment) return false;
    if (filters.enrichment === "not_enriched" && enrichment) return false;

    if (filters.revenueBuckets.length > 0) {
      const bucket = revenueBucketForBrand(enrichment);
      if (!filters.revenueBuckets.includes(bucket)) return false;
    }

    if (filters.employeeBuckets.length > 0) {
      const bucket = employeeBucketForBrand(enrichment);
      if (!filters.employeeBuckets.includes(bucket)) return false;
    }

    if (filters.fundingStages.length > 0) {
      const stage = enrichment?.latest_funding_stage?.trim().toLowerCase() ?? "";
      const hasFunding = enrichment?.total_funding != null || Boolean(stage);
      const matches = filters.fundingStages.some((filterStage) => {
        const normalized = filterStage.toLowerCase();
        if (normalized === "has_funding") return hasFunding;
        if (normalized === "no_funding_data") return !hasFunding;
        return stage.includes(normalized);
      });
      if (!matches) return false;
    }

    const teamCount = brand.teamPlacements.length;
    const venueCount = brand.venuePlacements.length;
    switch (filters.placementSource) {
      case "teams_only":
        if (teamCount === 0 || venueCount > 0) return false;
        break;
      case "venues_only":
        if (venueCount === 0 || teamCount > 0) return false;
        break;
      case "both":
        if (teamCount === 0 || venueCount === 0) return false;
        break;
      default:
        break;
    }

    if (filters.sportTypes.length > 0) {
      const sports = brandSportTypes(brand, venueSportByKey);
      if (!filters.sportTypes.some((sport) => sports.includes(sport.toLowerCase()))) {
        return false;
      }
    }

    if (filters.teamOwners.length > 0) {
      const owners = new Set(brand.teamPlacements.map((p) => p.owner_name));
      if (!filters.teamOwners.some((owner) => owners.has(owner))) return false;
    }

    if (filters.venueKeys.length > 0) {
      const keys = new Set(brand.venuePlacements.map((p) => p.entity_key));
      if (!filters.venueKeys.some((key) => keys.has(key))) return false;
    }

    if (filters.placementCountBuckets.length > 0) {
      const count = brandPlacementCount(brand);
      if (
        !filters.placementCountBuckets.some((bucket) =>
          placementCountMatchesBucket(count, bucket)
        )
      ) {
        return false;
      }
    }

    if (!q) return true;

    if (brand.displayName.toLowerCase().includes(q) || brand.key.includes(q)) {
      return true;
    }

    for (const placement of brand.teamPlacements) {
      const owner = placement.owner_name.toLowerCase();
      if (owner.includes(q) || matchingOwnerNames.has(owner)) return true;
    }

    for (const placement of brand.venuePlacements) {
      if (placement.venue_name.toLowerCase().includes(q)) return true;
    }

    return false;
  });
}

export function collectFundingStages(
  enrichmentByKey: Record<string, BrandEnrichmentRow>
): string[] {
  const stages = new Set<string>();
  for (const row of Object.values(enrichmentByKey)) {
    const stage = row.latest_funding_stage?.trim();
    if (stage) stages.add(stage);
  }
  return [...stages].sort((a, b) => a.localeCompare(b));
}

export function countActiveBrandFilters(filters: BrandFilters): number {
  let count = 0;
  if (filters.enrichment !== "all") count += 1;
  count += filters.revenueBuckets.length;
  count += filters.employeeBuckets.length;
  count += filters.fundingStages.length;
  if (filters.placementSource !== "all") count += 1;
  count += filters.placementCountBuckets.length;
  count += filters.sportTypes.length;
  count += filters.teamOwners.length;
  count += filters.venueKeys.length;
  return count;
}

export function countUniqueTeamOwners(teamSponsors: TeamSponsorRow[]): number {
  return new Set(teamSponsors.map((r) => r.owner_name)).size;
}
