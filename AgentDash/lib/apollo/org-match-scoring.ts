import type { ApolloOrganizationResult } from "@/lib/apollo/org-search-types";

/** Expand sponsorship category / industry into Apollo keyword tags. */
export function categoryToApolloKeywordTags(
  productCategory: string | null | undefined,
  industry: string | null | undefined
): string[] {
  const tags = new Set<string>();
  for (const raw of [productCategory, industry]) {
    const c = String(raw ?? "").trim().toLowerCase();
    if (!c) continue;
    tags.add(c);
    if (/apparel|clothing|fashion|sportswear|footwear/.test(c)) {
      ["apparel", "clothing", "fashion", "sportswear", "retail"].forEach((t) => tags.add(t));
    }
    if (/beverage|drink|energy/.test(c)) {
      ["beverage", "food & beverage", "consumer goods"].forEach((t) => tags.add(t));
    }
    if (/outdoor|action sport|skate|surf|snow/.test(c)) {
      ["outdoor", "sporting goods", "retail"].forEach((t) => tags.add(t));
    }
    if (/tech|software|saas/.test(c)) {
      ["technology", "software", "internet"].forEach((t) => tags.add(t));
    }
  }
  return [...tags];
}

const FINANCE_NAME_TOKENS = [
  "capital",
  "holdings",
  "partners",
  "private equity",
  "investment",
  "ventures",
  "asset management",
  "financial",
];

const FINANCE_INDUSTRY_TOKENS = [
  "financial",
  "investment",
  "private equity",
  "venture capital",
  "banking",
  "asset management",
];

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s&]/g, " ").replace(/\s+/g, " ").trim();
}

function isConsumerBrandCategory(productCategory: string | null | undefined): boolean {
  const c = String(productCategory ?? "").toLowerCase();
  if (!c) return false;
  return /apparel|clothing|fashion|beverage|drink|footwear|outdoor|sport|consumer|retail|energy drink/.test(
    c
  );
}

export type OrgMatchContext = {
  companyName: string;
  productCategory?: string | null;
  industry?: string | null;
};

export function scoreApolloOrganizationCandidate(
  org: ApolloOrganizationResult,
  ctx: OrgMatchContext
): number {
  let score = 0;
  const companyNorm = normalizeName(ctx.companyName);
  const orgNorm = normalizeName(org.name);
  const haystack = `${org.industry ?? ""} ${org.description ?? ""}`.toLowerCase();

  if (companyNorm === orgNorm) score += 100;
  else if (orgNorm.startsWith(`${companyNorm} `)) {
    const suffix = orgNorm.slice(companyNorm.length).trim();
    const badSuffix = FINANCE_NAME_TOKENS.some((t) => suffix.includes(t));
    score += badSuffix ? 15 : 55;
  } else if (orgNorm.includes(companyNorm)) score += 35;

  const categoryTags = categoryToApolloKeywordTags(ctx.productCategory, ctx.industry);
  for (const tag of categoryTags) {
    if (haystack.includes(tag.toLowerCase())) score += 12;
  }

  if (isConsumerBrandCategory(ctx.productCategory)) {
    if (FINANCE_NAME_TOKENS.some((t) => orgNorm.includes(t))) score -= 40;
    if (FINANCE_INDUSTRY_TOKENS.some((t) => haystack.includes(t))) score -= 35;
  }

  if (org.primary_domain) {
    const domainBase = org.primary_domain.split(".")[0]?.toLowerCase() ?? "";
    const companyToken = companyNorm.split(/\s+/)[0] ?? "";
    if (domainBase && companyToken && domainBase.includes(companyToken)) score += 25;
  }

  return score;
}

export function pickBestApolloOrganization(
  candidates: ApolloOrganizationResult[],
  ctx: OrgMatchContext
): ApolloOrganizationResult | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((org) => ({ org, score: scoreApolloOrganizationCandidate(org, ctx) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.org ?? null;
}

export function orgMatchConfidence(
  org: ApolloOrganizationResult,
  ctx: OrgMatchContext,
  resolvedViaDomain: boolean
): "high" | "medium" | "low" {
  if (resolvedViaDomain) return "high";
  const score = scoreApolloOrganizationCandidate(org, ctx);
  if (score >= 80) return "high";
  if (score >= 45) return "medium";
  return "low";
}

/** Drop people clearly tied to a different Apollo org than the one we resolved. */
export function personMatchesResolvedOrg(
  personOrgName: string,
  resolvedOrgName: string,
  companyName: string
): boolean {
  const person = normalizeName(personOrgName);
  const resolved = normalizeName(resolvedOrgName);
  const company = normalizeName(companyName);
  if (!person) return true;
  if (person === resolved || person === company) return true;
  const personFirst = person.split(/\s+/)[0] ?? "";
  const resolvedFirst = resolved.split(/\s+/)[0] ?? company.split(/\s+/)[0] ?? "";
  if (!personFirst || !resolvedFirst) return true;
  if (personFirst !== resolvedFirst) return false;
  if (person.includes("capital") && !resolved.includes("capital") && !company.includes("capital")) {
    return false;
  }
  return person.startsWith(resolvedFirst) || resolved.startsWith(personFirst);
}
