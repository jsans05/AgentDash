export const APPROVED_INTEREST_CATEGORIES = [
  "Activewear",
  "Art & Design",
  "Beauty & Cosmetics",
  "Beer, Wine & Spirits",
  "Business & Careers",
  "Camera & Photography",
  "Cars & Motorbikes",
  "Clothes, Shoes, Handbags & Accessories",
  "Coffee, Tea & Beverages",
  "Electronics & Computers",
  "Fitness & Yoga",
  "Friends, Family & Relationships",
  "Gaming",
  "Healthcare & Medicine",
  "Healthy Lifestyle",
  "Home Decor, Furniture & Garden",
  "Jewellery & Watches",
  "Luxury Goods",
  "Music",
  "Pets",
  "Restaurants, Food & Grocery",
  "Shopping & Retail",
  "Sports",
  "Television & Film",
  "Tobacco & Smoking",
  "Toys, Children & Baby",
  "Travel, Tourism & Aviation",
  "Wedding",
] as const;

export type ApprovedInterestCategory = (typeof APPROVED_INTEREST_CATEGORIES)[number];

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractApprovedInterestSelections(text: string): ApprovedInterestCategory[] {
  const t = normalize(String(text ?? ""));
  if (!t) return [];
  const found: ApprovedInterestCategory[] = [];
  const fragments = [t, ...t.split(/\s*,\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean)];
  for (const frag of fragments) {
    for (const label of APPROVED_INTEREST_CATEGORIES) {
      const needle = normalize(label);
      if (frag.includes(needle)) found.push(label);
    }
  }
  // Common shorthand → canonical label (compound replies e.g. "Healthy Lifestyle and Fitness")
  if (t.includes("fitness") && !found.includes("Fitness & Yoga")) found.push("Fitness & Yoga");
  if (t.includes("yoga") && !found.includes("Fitness & Yoga")) found.push("Fitness & Yoga");
  return [...new Set(found)];
}

export function formatApprovedInterestListMarkdown(): string {
  return APPROVED_INTEREST_CATEGORIES.map((c) => `- ${c}`).join("\n");
}

