import { audiencePercentPoints, type AthleteAudienceProfile } from "@/lib/athlete-data";
import { normalizeCategoryForMatch } from "@/lib/taxonomy";

type SignalRow = {
  audience_name: string;
  ig_audience_percent: number;
};

export type ProspectingSignal = {
  name: string;
  percent: number;
  display: string;
};

export type ProspectingAudienceSignals = {
  ageBands: string[];
  genderSplit: string[];
  topCountries: string[];
  topInterests: ProspectingSignal[];
  topBrandAffinities: ProspectingSignal[];
  demographicInferences: string[];
};

export type PrioritizedCategoryResult = {
  orderedCategories: string[];
  prioritizedCategories: string[];
  unmatchedPriorityTerms: string[];
};

function asSignalRows(rows: SignalRow[], limit: number): ProspectingSignal[] {
  return rows.slice(0, limit).map((row) => {
    const percent = audiencePercentPoints(Number(row.ig_audience_percent ?? 0));
    return {
      name: row.audience_name,
      percent,
      display: `${row.audience_name} (${percent.toFixed(1)}%)`,
    };
  });
}

function parseAgeBandBounds(label: string): { min: number; max: number } | null {
  const text = String(label ?? "");
  const rangeMatch = text.match(/(\d{2})\s*[-–]\s*(\d{2})/);
  if (rangeMatch) {
    return { min: Number(rangeMatch[1]), max: Number(rangeMatch[2]) };
  }
  const plusMatch = text.match(/(\d{2})\s*\+/);
  if (plusMatch) {
    const min = Number(plusMatch[1]);
    return { min, max: min + 8 };
  }
  return null;
}

function weightedAverageAge(ageRows: SignalRow[]): number | null {
  let weighted = 0;
  let total = 0;
  for (const row of ageRows) {
    const bounds = parseAgeBandBounds(row.audience_name);
    if (!bounds) continue;
    const midpoint = (bounds.min + bounds.max) / 2;
    const weight = Number(row.ig_audience_percent ?? 0);
    weighted += midpoint * weight;
    total += weight;
  }
  if (total <= 0) return null;
  return weighted / total;
}

function genderShare(genderRows: SignalRow[], keyword: string): number {
  const lower = keyword.toLowerCase();
  return genderRows
    .filter((row) => row.audience_name.toLowerCase().includes(lower))
    .reduce((acc, row) => acc + Number(row.ig_audience_percent ?? 0), 0);
}

function notePriorityTerms(text: string): string[] {
  const cleaned = String(text ?? "").trim();
  if (!cleaned) return [];
  const snippets: string[] = [];
  const re = /(look for|prioritize|focus on|target)\s+([^.!?\n]+)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(cleaned)) !== null) {
    snippets.push(match[2] ?? "");
  }
  if (snippets.length === 0) return [];
  return snippets
    .join(",")
    .split(/,|\/| and /i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function tokenizePriorityTerms(input: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of input) {
    if (!raw) continue;
    const parts = String(raw)
      .split(/,|\/| and /i)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(part);
    }
  }
  return ordered;
}

export function buildProspectingAudienceSignals(
  summary: Pick<AthleteAudienceProfile, "age" | "gender" | "countries" | "interests" | "brands">
): ProspectingAudienceSignals {
  const topInterests = asSignalRows(summary.interests, 10);
  const topBrandAffinities = asSignalRows(summary.brands, 10);
  const ageBands = asSignalRows(summary.age, 5).map((row) => row.display);
  const genderSplit = asSignalRows(summary.gender, 5).map((row) => row.display);
  const topCountries = asSignalRows(summary.countries, 5).map((row) => row.display);

  const inferences: string[] = [];
  const avgAge = weightedAverageAge(summary.age);
  if (avgAge != null) {
    if (avgAge >= 35) inferences.push("Audience skews older (35+).");
    else if (avgAge <= 24) inferences.push("Audience skews younger (under 25).");
    else inferences.push("Audience age centers around young-to-mid adults.");
  }

  const womenShare = genderShare(summary.gender, "female");
  const menShare = genderShare(summary.gender, "male");
  if (womenShare >= menShare + 0.05) inferences.push("Audience skews women.");
  else if (menShare >= womenShare + 0.05) inferences.push("Audience skews men.");
  else if (womenShare > 0 || menShare > 0) inferences.push("Audience gender split is fairly balanced.");

  const topCountry = summary.countries[0]?.audience_name;
  if (topCountry) {
    inferences.push(`Top geography concentration is ${topCountry}.`);
  }

  return {
    ageBands,
    genderSplit,
    topCountries,
    topInterests,
    topBrandAffinities,
    demographicInferences: inferences,
  };
}

export function prioritizeProspectingCategories(params: {
  categories: string[];
  requestedCategories?: string[];
  categoryHint?: string | null;
  athleteNotes?: string | null;
}): PrioritizedCategoryResult {
  const categories = Array.from(new Set(params.categories.filter(Boolean)));
  const requested = tokenizePriorityTerms([
    ...(params.requestedCategories ?? []),
    params.categoryHint ?? null,
    ...notePriorityTerms(params.athleteNotes ?? ""),
  ]);

  if (requested.length === 0) {
    return {
      orderedCategories: categories,
      prioritizedCategories: [],
      unmatchedPriorityTerms: [],
    };
  }

  const matchedCategories: string[] = [];
  const unmatchedTerms: string[] = [];
  const categoryPool = categories.map((c) => ({ value: c, norm: normalizeCategoryForMatch(c) }));

  for (const term of requested) {
    const normalizedTerm = normalizeCategoryForMatch(term);
    const direct = categoryPool.find(
      (category) =>
        category.norm.includes(normalizedTerm) || normalizedTerm.includes(category.norm)
    );
    if (!direct) {
      unmatchedTerms.push(term);
      continue;
    }
    if (!matchedCategories.includes(direct.value)) {
      matchedCategories.push(direct.value);
    }
  }

  const rest = categories.filter((c) => !matchedCategories.includes(c));
  return {
    orderedCategories: [...matchedCategories, ...rest],
    prioritizedCategories: matchedCategories,
    unmatchedPriorityTerms: unmatchedTerms,
  };
}

export function buildCategorySearchQueries(params: {
  category: string;
  topInterests: ProspectingSignal[];
  topBrandAffinities: ProspectingSignal[];
  demographicInferences: string[];
  priorityTerms?: string[];
}): string[] {
  const { category, topInterests, topBrandAffinities, demographicInferences, priorityTerms } = params;
  const topInterest = topInterests[0]?.name;
  const secondInterest = topInterests[1]?.name;
  const topBrand = topBrandAffinities[0]?.name;
  const demographicHint = demographicInferences[0] ?? "";
  const queries = [
    `${category} brands sports sponsorship`,
    `${category} companies ${topInterest ?? ""}`.trim(),
    `${category} sponsorship brands ${topBrand ?? ""}`.trim(),
    `${category} brands target audience ${demographicHint}`.trim(),
    `${category} companies ${secondInterest ?? ""} market`.trim(),
    ...(priorityTerms ?? []).map((term) => `${term} ${category} brands`),
  ];

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const query of queries) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}
