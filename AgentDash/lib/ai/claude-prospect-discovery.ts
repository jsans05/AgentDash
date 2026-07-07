import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatCompletion } from "@/lib/ai/anthropic-chat-client";
import {
  gatherAthleteProspectingContext,
  type AthleteProspectDiscoveryParams,
  type AthleteProspectDiscoveryResult,
  type AthleteProspectingContext,
} from "@/lib/ai/athlete-prospect-discovery";
import {
  buildGroupedProspectsMarkdownFromDisplayScores,
  flattenClaudeDisplayRowsToProspectListRows,
  MAX_INTERNAL_PROSPECT_SCORE,
  type ClaudeProspectDisplayRow,
  type ProspectCategoryCandidate,
} from "@/lib/ai/grouped-prospecting";
import { validateGroupedProspectingOutput } from "@/lib/ai/output-validation";
import { normalizeCategoryForMatch } from "@/lib/taxonomy";

type ClaudeProspectJsonRow = {
  company_name: string;
  category: string;
  website?: string;
  match_score: number;
  justification: string;
};

function normalizeCompanyKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function clampMatchScore(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 50;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function extractJsonArray(text: string): unknown[] | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { prospects?: unknown[] }).prospects)) {
      return (parsed as { prospects: unknown[] }).prospects;
    }
  } catch {
    // fall through
  }

  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      const parsed = JSON.parse(candidate.slice(arrayStart, arrayEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function buildProspectingPrompt(ctx: AthleteProspectingContext): string {
  const constraints: string[] = [];
  if (ctx.revenueRangeMin != null || ctx.revenueRangeMax != null) {
    const min = ctx.revenueRangeMin != null ? `$${ctx.revenueRangeMin.toLocaleString()}` : "any";
    const max = ctx.revenueRangeMax != null ? `$${ctx.revenueRangeMax.toLocaleString()}` : "any";
    constraints.push(`Revenue range preference: ${min} – ${max} (annual, approximate).`);
  }
  if (ctx.organizationLocations?.length) {
    constraints.push(`HQ / organization locations preference: ${ctx.organizationLocations.join(", ")}.`);
  }

  const targetListBlock =
    ctx.targetListCompanies.length > 0
      ? ctx.targetListCompanies
          .map(
            (c) =>
              `- ${c.company_name}${c.category ? ` (${c.category})` : ""}${c.match_score != null ? ` [score ${c.match_score}]` : ""}`
          )
          .join("\n")
      : "(none)";

  const blockedCategoryBlock =
    ctx.blockedCategories.length > 0
      ? ctx.blockedCategories.map((b) => `- ${b.category}: ${b.reason}`).join("\n")
      : "(none)";

  const categoriesBlock =
    ctx.categoriesToSearch.length > 0
      ? ctx.categoriesToSearch.map((c) => `- ${c}`).join("\n")
      : "(no open categories after exclusivity filters)";

  return `You are a sports sponsorship prospecting strategist. Recommend sponsor brands for the athlete below.

## Athlete
- Name: ${ctx.athleteName}
- Sport: ${ctx.sport ?? "Unknown"}
- Notes: ${String(ctx.athlete.notes ?? "").trim() || "(none)"}

## Audience signals
- Top interests: ${ctx.audienceSignals.topInterests.map((s) => s.display).join("; ") || "(none)"}
- Top brand affinities: ${ctx.audienceSignals.topBrandAffinities.map((s) => s.display).join("; ") || "(none)"}
- Demographic inferences: ${ctx.audienceSignals.demographicInferences.join("; ") || "(none)"}

## Sponsorship taxonomy
- Already covered / blocked categories (do NOT recommend companies in these): ${ctx.existingCategories.join(", ") || "(none)"}
- Open categories to prospect (search these): 
${categoriesBlock}
- Prioritized categories: ${ctx.prioritizedCategories.join(", ") || "(none)"}

## Exclusivity-blocked categories (hard skip)
${blockedCategoryBlock}

## Companies already on this athlete's target list (do NOT re-recommend)
${targetListBlock}

## User direction
- Category focus: ${ctx.categoryHint ?? "(none)"}
- Full user request (honor likes, dislikes, style, and positioning verbatim): ${ctx.userRequestText || "(none)"}

${constraints.length ? `## Additional constraints\n${constraints.join("\n")}\n` : ""}
## Task
For each open category listed above, recommend ${ctx.minPerCategory} sponsor brands (best effort).
- Honor the user's likes, dislikes, and brand-style guidance (e.g. luxury vs mass-market, edgy vs conservative).
- Exclude any company already on the target list.
- Exclude companies in blocked/covered categories.
- Match scores are integers 0–100 (higher = stronger athlete–brand fit for this athlete and request).
- Partnership justifications must be specific: cite audience fit, brand positioning, and how the user's request shaped the pick.
- Leave website as an empty string unless you are confident in the official URL (import will auto-resolve missing sites).

Return ONLY a JSON array (no prose), each object:
{
  "company_name": string,
  "category": string,
  "website": string,
  "match_score": number,
  "justification": string
}`;
}

function parseClaudeProspectRows(
  raw: unknown[],
  ctx: AthleteProspectingContext
): ClaudeProspectJsonRow[] {
  const blockedCategorySet = new Set(
    [...ctx.existingCategories, ...ctx.blockedCategories.map((b) => b.category)].map((c) =>
      normalizeCategoryForMatch(c)
    )
  );
  const allowedCategorySet = new Set(ctx.categoriesToSearch.map((c) => normalizeCategoryForMatch(c)));
  const targetListKeys = new Set(ctx.targetListCompanies.map((c) => normalizeCompanyKey(c.company_name)));
  const seen = new Set<string>();
  const rows: ClaudeProspectJsonRow[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const company_name = String(record.company_name ?? record.name ?? "").trim();
    const category = String(record.category ?? "").trim();
    const justification = String(record.justification ?? record.partnership_justification ?? "").trim();
    if (!company_name || !category || !justification) continue;

    const companyKey = normalizeCompanyKey(company_name);
    if (!companyKey || seen.has(companyKey) || targetListKeys.has(companyKey)) continue;
    seen.add(companyKey);

    const categoryNorm = normalizeCategoryForMatch(category);
    if (blockedCategorySet.has(categoryNorm)) continue;
    if (allowedCategorySet.size > 0 && !allowedCategorySet.has(categoryNorm)) continue;

    rows.push({
      company_name,
      category,
      website: String(record.website ?? "").trim(),
      match_score: clampMatchScore(record.match_score),
      justification,
    });
  }

  return rows;
}

function groupDisplayRows(rows: ClaudeProspectJsonRow[]): Record<string, ClaudeProspectDisplayRow[]> {
  const grouped: Record<string, ClaudeProspectDisplayRow[]> = {};
  for (const row of rows) {
    const bucket = grouped[row.category] ?? [];
    bucket.push({
      name: row.company_name,
      website: row.website || undefined,
      match_score: row.match_score,
      justification: row.justification,
    });
    grouped[row.category] = bucket;
  }

  for (const category of Object.keys(grouped)) {
    grouped[category] = [...grouped[category]]
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 10);
  }

  return grouped;
}

function displayRowsToGroupedCandidates(
  grouped: Record<string, ClaudeProspectDisplayRow[]>
): Record<string, ProspectCategoryCandidate[]> {
  const out: Record<string, ProspectCategoryCandidate[]> = {};
  for (const [category, rows] of Object.entries(grouped)) {
    out[category] = rows.map((row) => ({
      name: row.name,
      industry: category,
      website: row.website,
      category,
      score: Math.round((row.match_score / 100) * MAX_INTERNAL_PROSPECT_SCORE),
      reason_tags: [],
      reason_summary: row.justification,
    }));
  }
  return out;
}

export async function discoverAthleteProspectsWithClaude(
  supabase: SupabaseClient,
  params: AthleteProspectDiscoveryParams
): Promise<AthleteProspectDiscoveryResult | null> {
  const ctx = await gatherAthleteProspectingContext(supabase, params);
  if (!ctx) return null;

  const blockedCompanies: AthleteProspectDiscoveryResult["blockedCompanies"] = ctx.blockedCategories.map(
    (b) => ({
      name: "N/A",
      category: b.category,
      taxonomy_id: b.taxonomy_id,
      reason: b.reason,
    })
  );

  if (ctx.categoriesToSearch.length === 0) {
    const markdown = `No viable prospect categories were found for ${ctx.athleteName} after applying exclusivity filters.`;
    return {
      athleteName: ctx.athleteName,
      sport: ctx.sport,
      existingCategories: ctx.existingCategories,
      endemicMissing: ctx.endemicMissing,
      nonEndemicMissing: ctx.nonEndemicMissing,
      categoriesMissing: ctx.categoriesMissing,
      prioritizedCategories: ctx.prioritizedCategories,
      unmetPriorityTerms: ctx.unmetPriorityTerms,
      groupedCandidates: {},
      blockedCompanies,
      markdown,
      rows: [],
      sources: [],
    };
  }

  const completion = await createChatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You recommend sponsorship brands for professional athletes. Return only valid JSON arrays as instructed — no markdown prose outside the JSON.",
        cache_control: { type: "ephemeral" },
      },
      { role: "user", content: buildProspectingPrompt(ctx) },
    ],
    temperature: 0.4,
  });

  const rawText = completion.choices[0]?.message?.content ?? "";
  const jsonArray = extractJsonArray(rawText);
  if (!jsonArray) {
    throw new Error("Claude prospect discovery returned no parseable JSON array");
  }

  const parsedRows = parseClaudeProspectRows(jsonArray, ctx);
  if (parsedRows.length === 0) {
    throw new Error("Claude prospect discovery returned no valid prospect rows after filtering");
  }

  const groupedDisplay = groupDisplayRows(parsedRows);
  let markdown = buildGroupedProspectsMarkdownFromDisplayScores({
    athleteName: ctx.athleteName,
    grouped: groupedDisplay,
    minPerCategory: ctx.minPerCategory,
  });

  const validation = validateGroupedProspectingOutput(markdown);
  if (!validation.ok) {
    throw new Error(validation.error ?? "Claude prospect markdown failed validation");
  }

  const groupedCandidates = displayRowsToGroupedCandidates(groupedDisplay);
  const rows = flattenClaudeDisplayRowsToProspectListRows(groupedDisplay);
  const sources = rows.map((r) => r.website || r.company_name).filter(Boolean);

  return {
    athleteName: ctx.athleteName,
    sport: ctx.sport,
    existingCategories: ctx.existingCategories,
    endemicMissing: ctx.endemicMissing,
    nonEndemicMissing: ctx.nonEndemicMissing,
    categoriesMissing: ctx.categoriesMissing,
    prioritizedCategories: ctx.prioritizedCategories,
    unmetPriorityTerms: ctx.unmetPriorityTerms,
    groupedCandidates,
    blockedCompanies,
    markdown,
    rows,
    sources,
  };
}
