import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";
import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { searchCompanies } from "@/lib/enrichment";
import {
  fetchTaxonomyNodesForSport,
  getTaxonomyBySport,
  resolveCategoryToTaxonomy,
} from "@/lib/taxonomy";
import OpenAI from "openai";
import { validateProspectingTable } from "@/lib/ai/output-validation";
import { OPENAI_CHAT_MODEL, OPENAI_REASONING_EFFORT } from "@/lib/ai/openai-chat-defaults";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** Normalize category for comparison (lowercase, trim, collapse spaces). */
function normalizeCategory(cat: string): string {
  return cat.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compute missing categories per tier for one sport (no cross-sport).
 * endemic_missing = endemic_taxonomy - existing_contract_categories
 * non_endemic_missing = non_endemic_taxonomy - existing_contract_categories
 */
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

/**
 * Extract audience signals from athlete_audience_data rows.
 */
function audienceSignalsFromSummary(summary: {
  age: { audience_name: string; ig_audience_percent: number }[];
  countries: { audience_name: string; ig_audience_percent: number }[];
  interests: { audience_name: string; ig_audience_percent: number }[];
  brands?: { audience_name: string; ig_audience_percent: number }[];
}) {
  return {
    ageBands: summary.age.map((a) => `${a.audience_name} (${audiencePercentPoints(a.ig_audience_percent).toFixed(1)}%)`),
    topCountries: summary.countries.slice(0, 5).map((c) => `${c.audience_name} (${audiencePercentPoints(c.ig_audience_percent).toFixed(1)}%)`),
    interests: summary.interests.slice(0, 10).map((i) => `${i.audience_name} (${audiencePercentPoints(i.ig_audience_percent).toFixed(1)}%)`),
    brands: (summary.brands ?? []).slice(0, 10).map((b) => `${b.audience_name} (${audiencePercentPoints(b.ig_audience_percent).toFixed(1)}%)`),
  };
}

function buildDeterministicProspectTable(
  athleteName: string,
  companies: Array<{ name: string; industry: string; category: string }>
): string {
  const header = "| Athlete | Company Recommendation | Industry | Rationale |";
  const divider = "| --- | --- | --- | --- |";
  const rows = companies.slice(0, 10).map((company) => {
    const rationale = `Targets open ${company.category} category and aligns with this athlete's known audience profile.`;
    return `| ${athleteName} | ${company.name} | ${company.industry || company.category} | ${rationale} |`;
  });
  return [header, divider, ...rows].join("\n");
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: athleteId } = await params;
  const profile = await requireProfile();
  const supabase = await createServerClient();

  // Check access
  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  // Get athlete
  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  const sport = athlete.sport?.trim() ?? null;

  // Get active contracts and their categories (from contract_exclusivities = single source of truth)
  const { data: contractsRaw } = await supabase
    .from("contracts")
    .select("contract_id, category, company_id")
    .eq("athlete_id", athleteId)
    .eq("archived", false)
    .in("status", ["active"]);

  const contracts = contractsRaw || [];
  const contractIds = contracts.map((c: any) => c.contract_id);

  const { data: exclusivitiesRaw } = contractIds.length > 0
    ? await supabase
        .from("contract_exclusivities")
        .select("taxonomy_id, contract_id, sponsorship_taxonomies:taxonomy_id(category)")
        .in("contract_id", contractIds)
    : { data: [] };

  const restrictedTaxonomyIds = new Set(
    (exclusivitiesRaw || []).map((e: any) => e.taxonomy_id)
  );
  let existingCategories = [
    ...new Set(
      (exclusivitiesRaw || [])
        .map((e: any) => (e.sponsorship_taxonomies as any)?.category)
        .filter(Boolean)
    ),
  ] as string[];

  // Athlete-level "covered" switches: user marked these as covered, so exclude from prospecting
  const { data: coveredRaw } = await supabase
    .from("athlete_covered_categories")
    .select("taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)")
    .eq("athlete_id", athleteId);
  for (const row of coveredRaw || []) {
    restrictedTaxonomyIds.add((row as any).taxonomy_id);
    const cat = (row as any).sponsorship_taxonomies?.category;
    if (cat) existingCategories.push(cat);
  }
  existingCategories = [...new Set(existingCategories)];

  if (existingCategories.length === 0 && (contracts as any[]).length > 0) {
    existingCategories = (contracts as any[]).map((c) => c.category).filter(Boolean);
  }

  const taxonomyNodes = sport ? await fetchTaxonomyNodesForSport(sport) : [];
  const categoryToTaxonomyId = new Map<string, string>();
  for (const node of taxonomyNodes) {
    const normalized = normalizeCategory(node.category);
    categoryToTaxonomyId.set(normalized, node.id);
  }

  const taxonomy = await getTaxonomyBySport(sport);
  const { endemicMissing, nonEndemicMissing } = getMissingByTier(
    existingCategories,
    taxonomy.endemic,
    taxonomy.nonEndemic
  );
  const categoriesMissing = [...endemicMissing, ...nonEndemicMissing];

  const audienceSummary = await getAthleteAudienceProfile(supabase, athleteId);
  const audienceSignals = audienceSignalsFromSummary(audienceSummary);

  // For top 5-10 missing categories, find candidate companies
  const topMissing = categoriesMissing.slice(0, 10);
  const companyCandidates: Array<{
    name: string;
    industry: string;
    website?: string;
    description?: string;
    category: string;
    taxonomy_id?: string;
    blocked?: boolean;
    blocked_reason?: string;
  }> = [];
  const blockedCompanies: Array<{
    name: string;
    category: string;
    taxonomy_id?: string;
    reason: string;
  }> = [];

  for (const category of topMissing) {
    try {
      const results = await searchCompanies(
        `${category} brands action sports sponsorship`
      );
      for (const result of results.slice(0, 3)) {
        // Resolve company category to taxonomy ID
        // The category variable is already from the taxonomy, so we can map it directly
        const taxonomyId = categoryToTaxonomyId.get(normalizeCategory(category));

        // Safety gate: block if taxonomy ID intersects with restricted exclusivities
        let blocked = false;
        let blockedReason = "";
        if (taxonomyId && restrictedTaxonomyIds.has(taxonomyId)) {
          blocked = true;
          blockedReason = `Category "${category}" is restricted by active contract exclusivity`;
        } else if (!taxonomyId && restrictedTaxonomyIds.size > 0) {
          // Conservative: if category unmapped and there are any exclusivities, block
          blocked = true;
          blockedReason = `Category "${category}" is unmapped and athlete has active exclusivities (needs review)`;
        }

        if (blocked) {
          blockedCompanies.push({
            name: result.name || "Unknown",
            category,
            taxonomy_id: taxonomyId,
            reason: blockedReason,
          });
        } else {
          companyCandidates.push({
            ...result,
            industry: result.industry || category,
            category,
            taxonomy_id: taxonomyId,
          });
        }
      }
    } catch (error) {
      console.error(`Failed to search companies for ${category}:`, error);
    }
  }

  // Use AI to rank and generate rationales
  const athleteName = `${athlete.first_name} ${athlete.last_name}`;
  const prompt = `You are a sports sponsorship prospecting assistant. For athlete ${athleteName}, suggest companies to contact that fill missing sponsor categories.

Athlete info:
- Name: ${athleteName}
- Sport: ${athlete.sport || "Unknown"}
- Location: ${[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "Unknown"}

Existing sponsor categories: ${existingCategories.length > 0 ? existingCategories.join(", ") : "None"}

Missing categories to fill: ${topMissing.join(", ")}

Audience signals:
- Age bands: ${audienceSignals.ageBands.length > 0 ? audienceSignals.ageBands.join("; ") : "Not available"}
- Top countries: ${audienceSignals.topCountries.length > 0 ? audienceSignals.topCountries.join("; ") : "Not available"}
- Interests: ${audienceSignals.interests.length > 0 ? audienceSignals.interests.join("; ") : "Not available"}

Candidate companies found:
${companyCandidates.map((c, i) => `${i + 1}. ${c.name} (${c.category}) - ${c.description || "No description"}`).join("\n")}

Generate a markdown table with exactly these columns:
| Athlete | Company Recommendation | Industry | Rationale |

Rules:
- Include only companies that align with athlete's audience (age bands, geography, interests)
- Prioritize companies in missing categories
- Rationale should explain: (1) why this category is a gap, (2) why this company fits the athlete's audience
- Return ONLY the table, no other text
- Limit to top 10 recommendations`;

  let aiResponse = "";
  let sources: string[] = [];

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      reasoning_effort: OPENAI_REASONING_EFFORT,
      messages: [
        {
          role: "system",
          content:
            "You are a sports sponsorship prospecting assistant. Generate markdown tables with exact column format as requested.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    aiResponse = completion.choices[0].message.content || "";
    const validation = validateProspectingTable(aiResponse);
    if (!validation.ok) {
      aiResponse = buildDeterministicProspectTable(athleteName, companyCandidates);
    }
    sources = companyCandidates.map((c) => c.website || c.name).filter(Boolean);
  } catch (error) {
    console.error("AI prospecting error:", error);
    return NextResponse.json(
      { error: "Failed to generate prospects" },
      { status: 500 }
    );
  }

  // Log the prospecting run (include blocked companies)
  try {
    await supabase.from("prospecting_logs").insert({
      athlete_id: athleteId,
      user_id: profile.user_id,
      categories_present: existingCategories,
      categories_missing: categoriesMissing,
      companies: {
        recommended: companyCandidates,
        blocked: blockedCompanies,
        restricted_taxonomy_ids: Array.from(restrictedTaxonomyIds),
      },
      sources,
      request_messages: [{ role: "user", content: prompt }],
      response_text: aiResponse,
    });
  } catch (logError) {
    console.error("Failed to log prospecting run:", logError);
    // Don't fail the request if logging fails
  }

  return NextResponse.json({
    athlete: athleteName,
    sport,
    categoriesPresent: existingCategories,
    endemicMissing,
    nonEndemicMissing,
    categoriesMissing,
    prospects: aiResponse,
    sources,
    blockedCompanies: blockedCompanies.length > 0 ? blockedCompanies : undefined,
    blockedCount: blockedCompanies.length,
  });
}
