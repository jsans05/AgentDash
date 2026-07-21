/** True when `companies.product_category` should be treated as "no real category yet" for imports and AI updates. */
export function isEffectivelyUncategorizedCompanyCategory(value: unknown): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return !s || s === "uncategorized";
}

/**
 * Map known category aliases to a single display/import name so spreadsheet
 * labels like "Airlines" and legacy CRM values like "Travel - Airlines" land
 * in the same target-list bucket.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  "travel - airlines": "Airlines",
  "travel-airlines": "Airlines",
  airline: "Airlines",
  airlines: "Airlines",
  "travel - hotels": "Travel - Hotels",
  "travel-hotels": "Travel - Hotels",
  hotels: "Travel - Hotels",
  grocery: "Grocery & Delivery",
  "grocery and delivery": "Grocery & Delivery",
  "grocery & delivery": "Grocery & Delivery",
  "music & audio": "Audio & Headphones",
  "music and audio": "Audio & Headphones",
  "audio & headphones": "Audio & Headphones",
  "audio and headphones": "Audio & Headphones",
};

export function canonicalizeCompanyCategory(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const mapped = CATEGORY_ALIASES[raw.toLowerCase()];
  return mapped ?? raw;
}
