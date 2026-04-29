export type IndustryInterestKey =
  | "fitness"
  | "apparel"
  | "camera"
  | "beverage"
  | "automotive"
  | "gaming"
  | "beauty"
  | "travel"
  | "food"
  | "tech"
  | "finance"
  | "family"
  | "entertainment"
  | "pets"
  | null;

export const APPROVED_INTEREST_TAXONOMY: string[] = [
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
];

// Deterministic industry -> allowed interest categories (order matters for relevance).
export const industryInterestMap: Record<Exclude<IndustryInterestKey, null>, string[]> = {
  fitness: ["Fitness & Yoga", "Healthy Lifestyle", "Sports", "Activewear"],
  apparel: ["Activewear", "Clothes, Shoes, Handbags & Accessories", "Luxury Goods", "Jewellery & Watches"],
  camera: ["Camera & Photography", "Electronics & Computers", "Travel, Tourism & Aviation", "Sports"],
  beverage: ["Coffee, Tea & Beverages", "Restaurants, Food & Grocery", "Healthy Lifestyle", "Beer, Wine & Spirits"],
  automotive: ["Cars & Motorbikes", "Sports", "Travel, Tourism & Aviation"],
  gaming: ["Gaming", "Electronics & Computers"],
  beauty: ["Beauty & Cosmetics", "Healthy Lifestyle", "Luxury Goods"],
  travel: ["Travel, Tourism & Aviation", "Sports", "Camera & Photography"],
  food: ["Restaurants, Food & Grocery", "Coffee, Tea & Beverages", "Healthy Lifestyle"],
  tech: ["Electronics & Computers", "Gaming", "Camera & Photography", "Business & Careers"],
  finance: ["Business & Careers", "Luxury Goods", "Shopping & Retail"],
  family: ["Friends, Family & Relationships", "Toys, Children & Baby", "Wedding"],
  entertainment: ["Music", "Television & Film", "Art & Design"],
  pets: ["Pets"],
};

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

// Explicit, deterministic mapping from incoming industry/category strings to industry keys.
// Matching uses keyword inclusion (no fuzzy interest guessing; interest names are matched exactly later).
export const industryAliasMap: Record<Exclude<IndustryInterestKey, null>, string[]> = {
  fitness: [
    "fitness",
    "health",
    "wellness",
    "supplement",
    "supplements",
    "recovery",
    "nutrition",
    "yoga",
    "athletic",
    "sport performance",
  ],
  apparel: ["apparel", "clothing", "fashion", "wetsuit", "shoes", "accessories", "jewelry", "jewellery", "luxury"],
  camera: ["camera", "photography", "photo", "imaging", "lens", "electronics", "computers", "tech", "gopro"],
  beverage: ["beverage", "coffee", "tea", "energy drink", "sports drink", "water", "soda", "beer", "wine", "spirits"],
  automotive: ["automotive", "car", "cars", "motorbike", "motorcycle", "bike", "motorsports", "two wheel", "motorsports"],
  gaming: ["gaming", "game", "esports"],
  beauty: ["beauty", "cosmetics", "skincare", "personal care"],
  travel: ["travel", "tourism", "aviation", "hotel", "airline", "air travel"],
  food: ["food", "restaurant", "grocery", "meal", "snack", "cafe"],
  tech: ["technology", "electronics", "computers", "software", "saas", "consumer electronics"],
  finance: ["finance", "bank", "insurance", "credit", "invest", "wealth", "fintech"],
  family: ["family", "kids", "children", "baby", "wedding"],
  entertainment: ["music", "film", "television", "tv", "entertainment", "media", "broadcast", "chef", "personality"],
  pets: ["pet", "pets", "dog", "cat"],
};

export const canonicalInterestByNormalized = Object.fromEntries(
  APPROVED_INTEREST_TAXONOMY.map((c) => [normalizeLabel(c), c])
) as Record<string, string>;

export function resolveIndustryInterestKey(targetIndustryOrCategory: string | null | undefined): Exclude<IndustryInterestKey, null> | null {
  const t = (targetIndustryOrCategory ?? "").trim().toLowerCase();
  if (!t) return null;

  // Rank aliases by first match to keep deterministic behavior.
  // We iterate industry keys in a fixed order (object literal insertion order).
  for (const [industryKey, aliases] of Object.entries(industryAliasMap) as Array<
    [Exclude<IndustryInterestKey, null>, string[]]
  >) {
    for (const alias of aliases) {
      if (t.includes(alias.toLowerCase())) return industryKey;
    }
  }
  return null;
}

export function getInterestCategoriesForBrandType(
  brandTypeText: string | null | undefined
): { industryKey: Exclude<IndustryInterestKey, null> | null; interests: string[] } {
  const industryKey = resolveIndustryInterestKey(brandTypeText);
  const interests = industryKey ? industryInterestMap[industryKey] : [];
  return { industryKey, interests };
}

