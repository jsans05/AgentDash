import {
  APPROVED_INTEREST_TAXONOMY,
  canonicalInterestByNormalized,
  industryInterestMap,
  resolveIndustryInterestKey,
  type IndustryInterestKey,
} from "@/lib/industry-interest-map";

type InterestItem = {
  name: string;
  value: number;
};

type ExcludedInterestReason =
  | "no_industry_mapping"
  | "non_approved_interest_label"
  | "not_in_allowed_interest_set";

export type RelevantAudienceInterestsDebug = {
  targetIndustryOrCategory: string | null;
  industryKey: Exclude<IndustryInterestKey, null> | null;
  mappedValidCategories: string[];
  usedInterests: InterestItem[];
  excludedInterests: Array<{
    name: string;
    value: number;
    reason: ExcludedInterestReason;
  }>;
  interestStrength: {
    maxInterestPct: number | null;
    usedCount: number;
  };
};

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getRelevantAudienceInterests(
  targetIndustryOrCategory: string | null | undefined,
  athleteAudienceInterests: InterestItem[],
  opts?: {
    maxUsedInterests?: number;
    debugLog?: boolean;
  }
): RelevantAudienceInterestsDebug {
  const maxUsedInterests = Math.max(1, Math.min(opts?.maxUsedInterests ?? 3, 10));
  const debugLog = opts?.debugLog ?? false;

  const target = (targetIndustryOrCategory ?? null) && String(targetIndustryOrCategory ?? "").trim() ? String(targetIndustryOrCategory) : null;
  const industryKey = resolveIndustryInterestKey(target);

  const mappedValidCategories = industryKey ? industryInterestMap[industryKey] : [];
  const mappedValidSet = new Set(mappedValidCategories);

  const usedInterests: InterestItem[] = [];
  const excludedInterests: RelevantAudienceInterestsDebug["excludedInterests"] = [];

  const approvedSet = new Set(APPROVED_INTEREST_TAXONOMY.map((c) => normalizeLabel(c)));

  for (const i of athleteAudienceInterests ?? []) {
    const rawName = String(i.name ?? "").trim();
    const value = typeof i.value === "number" && !Number.isNaN(i.value) ? i.value : 0;
    if (!rawName) continue;

    const normalized = normalizeLabel(rawName);
    const canonical = canonicalInterestByNormalized[normalized];

    if (!industryKey) {
      excludedInterests.push({ name: rawName, value, reason: "no_industry_mapping" });
      continue;
    }

    // Strict: only allow exact approved taxonomy names.
    if (!canonical || !approvedSet.has(normalized)) {
      excludedInterests.push({ name: rawName, value, reason: "non_approved_interest_label" });
      continue;
    }

    if (!mappedValidSet.has(canonical)) {
      excludedInterests.push({ name: canonical, value, reason: "not_in_allowed_interest_set" });
      continue;
    }

    usedInterests.push({ name: canonical, value });
  }

  const interestStrength = {
    maxInterestPct: usedInterests.length ? Math.max(...usedInterests.map((x) => x.value)) : null,
    usedCount: usedInterests.length,
  };

  // Deterministic ranking:
  // 1) Higher audience percentage strength (interest_pct)
  // 2) If tied/close, prefer direct industry relevance (lower index in industryInterestMap list)
  // 3) Stable tie-break on name
  const relevanceIndex = new Map(mappedValidCategories.map((c, idx) => [c, idx]));
  usedInterests.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    const ra = relevanceIndex.get(a.name) ?? Number.POSITIVE_INFINITY;
    const rb = relevanceIndex.get(b.name) ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  const usedTop = usedInterests.slice(0, maxUsedInterests);

  const debug: RelevantAudienceInterestsDebug = {
    targetIndustryOrCategory: target,
    industryKey,
    mappedValidCategories,
    usedInterests: usedTop,
    excludedInterests,
    interestStrength,
  };

  if (debugLog) {
    // Useful for inspecting mismatches (non-approved labels, mapping misses, etc.)
    // eslint-disable-next-line no-console
    console.log("[interest-filter]", debug);
  }

  return debug;
}

