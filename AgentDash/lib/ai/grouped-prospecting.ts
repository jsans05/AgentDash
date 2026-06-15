import type { ProspectingSignal } from "@/lib/ai/prospecting-signals";

export const PROSPECTING_TABLE_HEADER =
  "| Company | Match Score | Website | Partnership Justification |";

export const PROSPECTING_TABLE_SEPARATOR = "| --- | --- | --- | --- |";

export type ProspectCategoryCandidate = {
  name: string;
  industry: string;
  website?: string;
  description?: string;
  category: string;
  taxonomy_id?: string;
  apollo_organization_id?: string;
  score: number;
  reason_tags: string[];
  reason_summary: string;
};

export type ProspectListRow = {
  company_name: string;
  category: string;
  match_score: number;
  website: string | null;
  justification: string;
};

const TAG_TO_JUSTIFICATION: Record<string, string> = {
  "user request": "Aligns with the user's requested sponsorship priorities",
  "interest match": "Audience interest overlap supports brand relevance",
  "brand affinity match": "Athlete audience already engages with this brand category",
  "demographic fit": "Demographic signals suggest a strong audience fit",
};

/** Internal rubric max from scoreCategoryCandidate (4+3+2+1). */
export const MAX_INTERNAL_PROSPECT_SCORE = 10;

export function matchScoreOutOf100(internalScore: number): number {
  const raw = Number(internalScore);
  if (!Number.isFinite(raw)) return 0;
  const normalized = Math.round((raw / MAX_INTERNAL_PROSPECT_SCORE) * 100);
  return Math.min(100, Math.max(0, normalized));
}

function normalizeCategory(cat: string): string {
  return cat.toLowerCase().trim().replace(/\s+/g, " ");
}

export function scoreCategoryCandidate(
  candidate: { name: string; description?: string; category: string },
  context: {
    prioritizedCategories: Set<string>;
    topInterests: ProspectingSignal[];
    topBrands: ProspectingSignal[];
    demographicInferences: string[];
  }
): { score: number; tags: string[] } {
  let score = 0;
  const tags: string[] = [];
  if (context.prioritizedCategories.has(normalizeCategory(candidate.category))) {
    score += 4;
    tags.push("user request");
  }

  const haystack = `${candidate.name} ${candidate.description ?? ""}`.toLowerCase();
  const matchedInterest = context.topInterests.find((interest) =>
    haystack.includes(interest.name.toLowerCase())
  );
  if (matchedInterest) {
    score += 3;
    tags.push("interest match");
  }

  const matchedBrand = context.topBrands.find((brand) => haystack.includes(brand.name.toLowerCase()));
  if (matchedBrand) {
    score += 2;
    tags.push("brand affinity match");
  }

  const demographicsMentioned = context.demographicInferences.some((cue) =>
    /older|younger|women|men|country|geography/i.test(cue)
  );
  if (demographicsMentioned) {
    score += 1;
    tags.push("demographic fit");
  }

  if (tags.length === 0) tags.push("interest match");
  return { score, tags };
}

export function buildPartnershipJustification(candidate: ProspectCategoryCandidate): string {
  const parts = candidate.reason_tags
    .map((tag) => TAG_TO_JUSTIFICATION[tag] ?? tag)
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0) {
    return candidate.reason_summary;
  }
  return unique.join("; ");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\n/g, " ").trim();
}

function formatWebsite(website: string | undefined): string {
  const w = String(website ?? "").trim();
  if (!w) return "—";
  let url = w;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let label = w;
  try {
    label = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    label = w.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0] ?? w;
  }
  return `[${escapeTableCell(label)}](${url})`;
}

export function flattenGroupedToRows(
  grouped: Record<string, ProspectCategoryCandidate[]>
): ProspectListRow[] {
  const rows: ProspectListRow[] = [];
  for (const [category, candidates] of Object.entries(grouped)) {
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    for (const c of sorted) {
      rows.push({
        company_name: c.name,
        category,
        match_score: matchScoreOutOf100(c.score),
        website: c.website?.trim() || null,
        justification: buildPartnershipJustification(c),
      });
    }
  }
  return rows;
}

export function buildGroupedProspectsMarkdown(params: {
  athleteName: string;
  grouped: Record<string, ProspectCategoryCandidate[]>;
  minPerCategory: number;
}): string {
  const sections: string[] = [];
  const categories = Object.keys(params.grouped);

  for (const category of categories) {
    const entries = [...(params.grouped[category] ?? [])].sort((a, b) => b.score - a.score);
    sections.push(`## ${category}`);
    if (entries.length < params.minPerCategory) {
      sections.push(
        `_Best effort: found ${entries.length} brand${entries.length === 1 ? "" : "s"} for this category (target minimum ${params.minPerCategory})._`
      );
    }
    sections.push(PROSPECTING_TABLE_HEADER);
    sections.push(PROSPECTING_TABLE_SEPARATOR);
    for (const candidate of entries) {
      const justification = buildPartnershipJustification(candidate);
      const displayScore = matchScoreOutOf100(candidate.score);
      sections.push(
        `| ${escapeTableCell(candidate.name)} | ${displayScore} | ${formatWebsite(candidate.website)} | ${escapeTableCell(justification)} |`
      );
    }
    sections.push("");
  }

  if (sections.length === 0) {
    return `No viable prospect categories were found for ${params.athleteName} after applying exclusivity filters.`;
  }
  return sections.join("\n").trim();
}
