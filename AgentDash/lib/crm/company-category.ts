/** True when `companies.product_category` should be treated as "no real category yet" for imports and AI updates. */
export function isEffectivelyUncategorizedCompanyCategory(value: unknown): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return !s || s === "uncategorized";
}
