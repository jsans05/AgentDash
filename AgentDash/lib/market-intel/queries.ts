import type { SupabaseClient } from "@supabase/supabase-js";

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

export type BrandSortKey =
  | "brand-asc"
  | "brand-desc"
  | "placements-asc"
  | "placements-desc";

export function brandPlacementCount(brand: AggregatedBrand): number {
  return brand.teamPlacements.length + brand.venuePlacements.length;
}

export function sortBrands(
  brands: AggregatedBrand[],
  sort: BrandSortKey
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
  }
  return sorted;
}

export function filterBrands(
  brands: AggregatedBrand[],
  query: string,
  cupDrivers: CupDriverRow[]
): AggregatedBrand[] {
  const q = query.trim().toLowerCase();
  if (!q) return brands;

  const matchingOwnerNames = new Set<string>();
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

  return brands.filter((brand) => {
    if (
      brand.displayName.toLowerCase().includes(q) ||
      brand.key.includes(q)
    ) {
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

export function countUniqueTeamOwners(teamSponsors: TeamSponsorRow[]): number {
  return new Set(teamSponsors.map((r) => r.owner_name)).size;
}
