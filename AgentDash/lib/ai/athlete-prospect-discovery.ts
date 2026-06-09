import type { SupabaseClient } from "@supabase/supabase-js";
import { getAthleteAudienceProfile } from "@/lib/athlete-data";
import { companyDiscoveryProvider } from "@/lib/apollo/config";
import { searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
import { searchCompanies } from "@/lib/enrichment";
import {
  fetchTaxonomyNodesForSport,
  getTaxonomyBySport,
  normalizeCategoryForMatch,
} from "@/lib/taxonomy";
import {
  buildCategorySearchQueries,
  buildProspectingAudienceSignals,
  prioritizeProspectingCategories,
} from "@/lib/ai/prospecting-signals";
import {
  buildGroupedProspectsMarkdown,
  flattenGroupedToRows,
  scoreCategoryCandidate,
  type ProspectCategoryCandidate,
  type ProspectListRow,
} from "@/lib/ai/grouped-prospecting";

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

export type AthleteProspectDiscoveryParams = {
  athleteId: string;
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

export async function discoverAthleteProspects(
  supabase: SupabaseClient,
  params: AthleteProspectDiscoveryParams
): Promise<AthleteProspectDiscoveryResult | null> {
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
  const revenueRangeMin = params.revenueRangeMin;
  const revenueRangeMax = params.revenueRangeMax;
  const organizationLocations = params.organizationLocations;
  const useApolloDiscovery = companyDiscoveryProvider() === "apollo";
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
        .map((e: { sponsorship_taxonomies?: { category?: string } | null }) => e.sponsorship_taxonomies?.category)
        .filter(Boolean)
    ),
  ] as string[];

  const { data: coveredRaw } = await supabase
    .from("athlete_covered_categories")
    .select("taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)")
    .eq("athlete_id", athleteId);
  for (const row of coveredRaw || []) {
    restrictedTaxonomyIds.add((row as { taxonomy_id: string }).taxonomy_id);
    const cat = (row as { sponsorship_taxonomies?: { category?: string } }).sponsorship_taxonomies?.category;
    if (cat) existingCategories.push(cat);
  }
  existingCategories = [...new Set(existingCategories)];

  if (existingCategories.length === 0 && contracts.length > 0) {
    existingCategories = contracts.map((c: { category?: string }) => c.category).filter(Boolean) as string[];
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

  const categoriesToSearch = (
    params.categoriesOverride?.length
      ? params.categoriesOverride
      : prioritized.orderedCategories
  ).slice(0, 10);

  const prioritizedCategorySet = new Set(
    prioritized.prioritizedCategories.map((category) => normalizeCategoryForMatch(category))
  );
  const groupedCandidates: Record<string, ProspectCategoryCandidate[]> = {};
  const blockedCompanies: AthleteProspectDiscoveryResult["blockedCompanies"] = [];

  for (const category of categoriesToSearch) {
    try {
      const taxonomyId = categoryToTaxonomyId.get(normalizeCategory(category));
      let categoryBlockedReason = "";
      if (taxonomyId && restrictedTaxonomyIds.has(taxonomyId)) {
        categoryBlockedReason = `Category "${category}" is restricted by active contract exclusivity`;
      } else if (!taxonomyId && restrictedTaxonomyIds.size > 0) {
        categoryBlockedReason = `Category "${category}" is unmapped and athlete has active exclusivities (needs review)`;
      }
      if (categoryBlockedReason) {
        blockedCompanies.push({
          name: "N/A",
          category,
          taxonomy_id: taxonomyId,
          reason: categoryBlockedReason,
        });
        continue;
      }

      const queries = buildCategorySearchQueries({
        category,
        topInterests: audienceSignals.topInterests,
        topBrandAffinities: audienceSignals.topBrandAffinities,
        demographicInferences: audienceSignals.demographicInferences,
        priorityTerms: [
          ...requestedCategories,
          ...(categoryHint ? [categoryHint] : []),
          ...prioritized.unmatchedPriorityTerms,
        ],
      });

      const uniqueByName = new Map<string, ProspectCategoryCandidate>();

      const ingestResult = (result: {
        name: string;
        industry?: string;
        website?: string;
        description?: string;
        apollo_organization_id?: string;
      }) => {
        const name = String(result.name ?? "").trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (uniqueByName.has(key)) return;
        const scoreInfo = scoreCategoryCandidate(
          { name, description: result.description, category },
          {
            prioritizedCategories: prioritizedCategorySet,
            topInterests: audienceSignals.topInterests,
            topBrands: audienceSignals.topBrandAffinities,
            demographicInferences: audienceSignals.demographicInferences,
          }
        );
        uniqueByName.set(key, {
          name,
          industry: result.industry || category,
          website: result.website,
          description: result.description,
          category,
          taxonomy_id: taxonomyId,
          apollo_organization_id: result.apollo_organization_id,
          score: scoreInfo.score,
          reason_tags: scoreInfo.tags,
          reason_summary: `Fits ${category} opportunity for this athlete`,
        });
      };

      if (useApolloDiscovery) {
        const keywordTags = [category, sport, ...queries.slice(0, 2)]
          .map((t) => String(t ?? "").trim())
          .filter(Boolean);
        try {
          const { organizations } = await searchApolloOrganizationsAdvanced({
            keyword_tags: [...new Set(keywordTags)],
            revenue_range_min: revenueRangeMin,
            revenue_range_max: revenueRangeMax,
            organization_locations: organizationLocations,
            per_page: Math.max(minPerCategory * 3, 15),
          });
          for (const org of organizations) {
            ingestResult({
              name: org.name,
              industry: org.industry,
              website: org.website,
              description: org.description,
              apollo_organization_id: org.apollo_organization_id ?? undefined,
            });
          }
        } catch (apolloErr) {
          console.error(`Apollo org search failed for ${category}:`, apolloErr);
        }
      }

      if (uniqueByName.size < minPerCategory) {
        for (const query of queries) {
          const results = await searchCompanies(query, {
            revenue_range_min: revenueRangeMin,
            revenue_range_max: revenueRangeMax,
            organization_locations: organizationLocations,
          });
          for (const result of results) {
            ingestResult(result);
          }
          if (uniqueByName.size >= minPerCategory * 2) break;
        }
      }

      const ranked = Array.from(uniqueByName.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(minPerCategory, 8));
      if (ranked.length > 0) {
        groupedCandidates[category] = ranked;
      } else {
        blockedCompanies.push({
          name: "N/A",
          category,
          taxonomy_id: taxonomyId,
          reason: `No viable companies found from web search for "${category}"`,
        });
      }
    } catch (error) {
      console.error(`Failed to search companies for ${category}:`, error);
    }
  }

  const athleteName = `${athlete.first_name} ${athlete.last_name}`.trim();
  const markdown = buildGroupedProspectsMarkdown({
    athleteName,
    grouped: groupedCandidates,
    minPerCategory,
  });
  const rows = flattenGroupedToRows(groupedCandidates);
  const sources = Object.values(groupedCandidates)
    .flat()
    .map((c) => c.website || c.name)
    .filter(Boolean);

  return {
    athleteName,
    sport,
    existingCategories,
    endemicMissing,
    nonEndemicMissing,
    categoriesMissing,
    prioritizedCategories: prioritized.prioritizedCategories,
    unmetPriorityTerms: prioritized.unmatchedPriorityTerms,
    groupedCandidates,
    blockedCompanies,
    markdown,
    rows,
    sources,
  };
}
