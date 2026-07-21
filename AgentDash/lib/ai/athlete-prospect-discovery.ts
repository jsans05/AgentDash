import type { SupabaseClient } from "@supabase/supabase-js";
import { getAthleteAudienceProfile } from "@/lib/athlete-data";
import { fetchAthleteTargetListRows } from "@/lib/crm/athlete-target-list-server";
import {
  fetchTaxonomyNodesForSport,
  getTaxonomyBySport,
  normalizeCategoryForMatch,
} from "@/lib/taxonomy";
import {
  buildProspectingAudienceSignals,
  prioritizeProspectingCategories,
  type ProspectingAudienceSignals,
} from "@/lib/ai/prospecting-signals";
import type { ProspectCategoryCandidate, ProspectListRow } from "@/lib/ai/grouped-prospecting";

function normalizeCategory(cat: string): string {
  return cat.toLowerCase().trim().replace(/\s+/g, " ");
}

function getMissingByTier(
  existingCategories: string[],
  endemic: string[],
  nonEndemic: string[]
): { endemicMissing: string[]; nonEndemicMissing: string[] } {
  const existingSet = new Set(existingCategories.map(normalizeCategory));
  const endemicMissing = endemic.filter((c) => !existingSet.has(normalizeCategory(c)));
  const nonEndemicMissing = nonEndemic.filter((c) => !existingSet.has(normalizeCategory(c)));
  return { endemicMissing, nonEndemicMissing };
}

function taxonomyCategory(
  rel: { category?: string } | { category?: string }[] | null | undefined
): string | undefined {
  if (!rel) return undefined;
  if (Array.isArray(rel)) return rel[0]?.category;
  return rel.category;
}

export type AthleteProspectDiscoveryParams = {
  athleteId: string;
  userId?: string;
  requestedCategories?: string[];
  categoryHint?: string | null;
  userRequestText?: string;
  minPerCategory?: number;
  revenueRangeMin?: number;
  revenueRangeMax?: number;
  organizationLocations?: string[];
  categoriesOverride?: string[];
};

export type AthleteProspectDiscoveryResult = {
  athleteName: string;
  sport: string | null;
  existingCategories: string[];
  endemicMissing: string[];
  nonEndemicMissing: string[];
  categoriesMissing: string[];
  prioritizedCategories: string[];
  unmetPriorityTerms: string[];
  groupedCandidates: Record<string, ProspectCategoryCandidate[]>;
  blockedCompanies: Array<{
    name: string;
    category: string;
    taxonomy_id?: string;
    reason: string;
  }>;
  markdown: string;
  rows: ProspectListRow[];
  sources: string[];
};

export type AthleteProspectingContext = {
  athlete: Record<string, unknown>;
  athleteName: string;
  sport: string | null;
  existingCategories: string[];
  endemicMissing: string[];
  nonEndemicMissing: string[];
  categoriesMissing: string[];
  prioritizedCategories: string[];
  unmetPriorityTerms: string[];
  audienceSignals: ProspectingAudienceSignals;
  categoriesToSearch: string[];
  blockedCategories: Array<{
    category: string;
    taxonomy_id?: string;
    reason: string;
  }>;
  targetListCompanies: Array<{
    company_name: string;
    category: string | null;
    match_score: number | null;
  }>;
  minPerCategory: number;
  categoryHint: string | null;
  userRequestText: string;
  requestedCategories: string[];
  revenueRangeMin?: number;
  revenueRangeMax?: number;
  organizationLocations?: string[];
};

export async function gatherAthleteProspectingContext(
  supabase: SupabaseClient,
  params: AthleteProspectDiscoveryParams
): Promise<AthleteProspectingContext | null> {
  const athleteId = params.athleteId;
  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();
  if (!athlete) return null;

  const requestedCategories = (params.requestedCategories ?? [])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  const categoryHint = params.categoryHint?.trim() || null;
  const userRequestText = params.userRequestText?.trim() ?? "";
  const minPerCategory = Math.max(1, Math.min(params.minPerCategory ?? 5, 10));
  const sport = athlete.sport?.trim() ?? null;

  const { data: contractsRaw } = await supabase
    .from("contracts")
    .select("contract_id, category, company_id")
    .eq("athlete_id", athleteId)
    .eq("archived", false)
    .in("status", ["active"]);

  const contracts = contractsRaw || [];
  const contractIds = contracts.map((c: { contract_id: string }) => c.contract_id);

  const { data: exclusivitiesRaw } =
    contractIds.length > 0
      ? await supabase
          .from("contract_exclusivities")
          .select("taxonomy_id, contract_id, sponsorship_taxonomies:taxonomy_id(category)")
          .in("contract_id", contractIds)
      : { data: [] };

  const restrictedTaxonomyIds = new Set(
    (exclusivitiesRaw || []).map((e: { taxonomy_id: string }) => e.taxonomy_id)
  );

  let existingCategories = [
    ...new Set(
      (exclusivitiesRaw || [])
        .map((e) => taxonomyCategory(e.sponsorship_taxonomies))
        .filter(Boolean)
    ),
  ] as string[];

  const { data: coveredRaw } = await supabase
    .from("athlete_covered_categories")
    .select("taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)")
    .eq("athlete_id", athleteId);
  for (const row of coveredRaw || []) {
    restrictedTaxonomyIds.add((row as { taxonomy_id: string }).taxonomy_id);
    const cat = taxonomyCategory(
      (row as { sponsorship_taxonomies?: { category?: string } | { category?: string }[] | null })
        .sponsorship_taxonomies
    );
    if (cat) existingCategories.push(cat);
  }
  existingCategories = [...new Set(existingCategories)];

  if (existingCategories.length === 0 && contracts.length > 0) {
    existingCategories = contracts
      .map((c: { category?: string }) => c.category)
      .filter(Boolean) as string[];
  }

  const taxonomyNodes = sport ? await fetchTaxonomyNodesForSport(sport) : [];
  const categoryToTaxonomyId = new Map<string, string>();
  for (const node of taxonomyNodes) {
    categoryToTaxonomyId.set(normalizeCategory(node.category), node.id);
  }

  const taxonomy = await getTaxonomyBySport(sport);
  const { endemicMissing, nonEndemicMissing } = getMissingByTier(
    existingCategories,
    taxonomy.endemic,
    taxonomy.nonEndemic
  );
  const categoriesMissing = [...endemicMissing, ...nonEndemicMissing];

  const audienceSummary = await getAthleteAudienceProfile(supabase, athleteId);
  const audienceSignals = buildProspectingAudienceSignals(audienceSummary);
  const prioritized = prioritizeProspectingCategories({
    categories: categoriesMissing,
    requestedCategories,
    categoryHint,
    athleteNotes: [athlete.notes, userRequestText].filter(Boolean).join("\n"),
  });

  const categoriesRequested = (
    params.categoriesOverride?.length ? params.categoriesOverride : prioritized.orderedCategories
  ).slice(0, 10);

  const blockedCategories: AthleteProspectingContext["blockedCategories"] = [];
  const categoriesToSearch: string[] = [];

  for (const category of categoriesRequested) {
    const taxonomyId = categoryToTaxonomyId.get(normalizeCategory(category));
    let categoryBlockedReason = "";
    if (taxonomyId && restrictedTaxonomyIds.has(taxonomyId)) {
      categoryBlockedReason = `Category "${category}" is restricted by active contract exclusivity`;
    } else if (!taxonomyId && restrictedTaxonomyIds.size > 0) {
      categoryBlockedReason = `Category "${category}" is unmapped and athlete has active exclusivities (needs review)`;
    }
    if (categoryBlockedReason) {
      blockedCategories.push({ category, taxonomy_id: taxonomyId, reason: categoryBlockedReason });
    } else {
      categoriesToSearch.push(category);
    }
  }

  let targetListCompanies: AthleteProspectingContext["targetListCompanies"] = [];
  if (params.userId) {
    try {
      const targetRows = await fetchAthleteTargetListRows(supabase, params.userId, athleteId);
      targetListCompanies = targetRows.map((r) => ({
        company_name: r.company_name,
        category: r.category,
        match_score: r.match_score,
      }));
    } catch (err) {
      console.error("Failed to load athlete target list for prospecting context:", err);
    }
  }

  const athleteName = `${athlete.first_name} ${athlete.last_name}`.trim();

  return {
    athlete,
    athleteName,
    sport,
    existingCategories,
    endemicMissing,
    nonEndemicMissing,
    categoriesMissing,
    prioritizedCategories: prioritized.prioritizedCategories,
    unmetPriorityTerms: prioritized.unmatchedPriorityTerms,
    audienceSignals,
    categoriesToSearch,
    blockedCategories,
    targetListCompanies,
    minPerCategory,
    categoryHint,
    userRequestText,
    requestedCategories,
    revenueRangeMin: params.revenueRangeMin,
    revenueRangeMax: params.revenueRangeMax,
    organizationLocations: params.organizationLocations,
  };
}
