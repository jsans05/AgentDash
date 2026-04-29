import { createServerClient } from "@/lib/supabase/server";
import { getAthleteAudienceProfile } from "@/lib/athlete-data";
import { getTaxonomyBySport } from "@/lib/taxonomy";

type AthleteIntelContracts = {
  current: any[];
  expired: any[];
  upcoming: any[];
};

export type AthleteIntelligencePayload = {
  athlete: any | null;
  contracts: AthleteIntelContracts;
  social_data: any | null;
  audience_data: {
    summary: {
      brands: any[];
      interests: any[];
      gender: any[];
      age: any[];
      countries: any[];
      states: any[];
      cities: any[];
      ethnicity: any[];
    } | null;
  };
  accolades: string[];
  conflicts: any[];
  open_categories: string[];
  notes: string[];
};

export async function buildAthleteIntelligencePayload(
  athlete_id: string
): Promise<AthleteIntelligencePayload> {
  const supabase = await createServerClient();

  const notes: string[] = [];

  const [{ data: athlete }, { data: contractsRaw }, { data: coveredRows }, audienceProfile] =
    await Promise.all([
      supabase
        .from("athletes")
        .select("*")
        .eq("athlete_id", athlete_id)
        .maybeSingle(),
      supabase
        .from("contracts")
        .select("*")
        .eq("athlete_id", athlete_id),
      supabase
        .from("athlete_covered_categories")
        .select("sponsorship_taxonomies:taxonomy_id(category)")
        .eq("athlete_id", athlete_id),
      getAthleteAudienceProfile(supabase, athlete_id),
    ]);

  const now = new Date();
  const contracts: AthleteIntelContracts = { current: [], expired: [], upcoming: [] };
  for (const c of contractsRaw ?? []) {
    const end = c.end_date ? new Date(c.end_date) : null;
    const start = c.start_date ? new Date(c.start_date) : null;
    if (c.status === "active") {
      contracts.current.push(c);
    } else if (c.status === "expired" || (end && end < now)) {
      contracts.expired.push(c);
    } else if (start && start > now) {
      contracts.upcoming.push(c);
    }
  }

  const activeContractIds = [
    ...contracts.current.map((c: any) => c.contract_id),
    ...contracts.upcoming.map((c: any) => c.contract_id),
  ].filter(Boolean);

  const openCategories: string[] = [];
  const conflicts: any[] = [];

  const covered = (coveredRows ?? [])
    .map((r: any) => r.sponsorship_taxonomies?.category)
    .filter(Boolean);

  if (covered.length) {
    conflicts.push({
      type: "covered_categories",
      categories: covered,
    });
  }

  // Contract exclusivity categories (categories the athlete's active/upcoming contracts already block).
  let contractExclusivityCategories: string[] = [];
  if (activeContractIds.length > 0) {
    const { data: contractExclusivitiesRows } = await supabase
      .from("contract_exclusivities")
      .select("contract_id, sponsorship_taxonomies:taxonomy_id(category)")
      .in("contract_id", activeContractIds);

    contractExclusivityCategories = (contractExclusivitiesRows ?? [])
      .map((r: any) => r.sponsorship_taxonomies?.category)
      .filter(Boolean);
  }

  contractExclusivityCategories = Array.from(new Set(contractExclusivityCategories));
  if (contractExclusivityCategories.length > 0) {
    conflicts.push({
      type: "contract_exclusivity_categories",
      categories: contractExclusivityCategories,
    });
  }

  // Compute open categories from taxonomy minus conflicts (dedupe + preserve original order where possible).
  const conflictCategorySet = new Set<string>([
    ...covered,
    ...contractExclusivityCategories,
  ]);

  if (athlete?.sport) {
    const taxonomy = await getTaxonomyBySport(athlete.sport);
    const allTaxCats = taxonomy.all ?? [];
    for (const cat of allTaxCats) {
      if (!conflictCategorySet.has(cat)) openCategories.push(cat);
    }
  }

  return {
    athlete: athlete ?? null,
    contracts,
    social_data: audienceProfile.social ?? null,
    audience_data: {
      summary: {
        brands: audienceProfile.brands,
        interests: audienceProfile.interests,
        gender: audienceProfile.gender,
        age: audienceProfile.age,
        countries: audienceProfile.countries,
        states: audienceProfile.states,
        cities: audienceProfile.cities,
        ethnicity: audienceProfile.ethnicity,
      },
    },
    accolades: Array.isArray(athlete?.accolades) ? athlete!.accolades : [],
    conflicts,
    open_categories: openCategories,
    notes,
  };
}

/**
 * Example payload (shape only):
 *
 * {
 *   "athlete": {
 *     "athlete_id": "uuid",
 *     "first_name": "Jane",
 *     "last_name": "Doe",
 *     "sport": "Surf",
 *     "city": "San Clemente",
 *     "state": "CA",
 *     "country": "USA",
 *     "creatoriq_publisher_id": "12345",
 *     "accolades": ["World champion", "Rookie of the year"]
 *   },
 *   "contracts": {
 *     "current": [...],
 *     "expired": [...],
 *     "upcoming": [...]
 *   },
 *   "social_data": {
 *     "total_followers": 1234567,
 *     "avg_er_20p": 3.4,
 *     "ig_followers": 800000,
 *     "tt_followers": 200000,
 *     "fb_followers": 50000,
 *     "x_followers": 10000,
 *     "...": "other per-platform metrics"
 *   },
 *   "audience_data": {
 *     "summary": {
 *       "gender": [{ "label": "Female", "value": 60 }],
 *       "age": [{ "label": "18-24", "value": 35 }],
 *       "countries": [{ "name": "United States", "value": 40 }],
 *       "states": [{ "name": "California", "value": 25 }],
 *       "cities": [{ "name": "San Diego", "value": 10 }],
 *       "interests": [{ "name": "Surfing", "value": 50 }],
 *       "brands": [{ "name": "Nike", "value": 5 }]
 *     },
 *     "manual_categories": {
 *       "Gender": [...],
 *       "Combined_Age": [...],
 *       "Countries": [...],
 *       "States": [...],
 *       "Cities": [...],
 *       "Ethnicity": [...],
 *       "Interests": [...],
 *       "Brands": [...]
 *     }
 *   },
 *   "accolades": ["World champion"],
 *   "conflicts": [
 *     {
 *       "type": "covered_categories",
 *       "categories": ["Energy Drink", "Insurance"]
 *     }
 *   ],
 *   "open_categories": [],
 *   "notes": []
 * }
 */


