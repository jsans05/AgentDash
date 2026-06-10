import {
  audiencePercentPoints,
  type AthleteAudienceProfile,
  type AudienceRow,
} from "@/lib/athlete-data";
import type { IndustryInterestKey } from "@/lib/industry-interest-map";

export type SuggestedPitchAngle = {
  kind: "interest" | "age" | "gender" | "country" | "brand_affinity";
  value: string;
  strength: "strong" | "medium" | "weak";
  reason?: string;
};

type InterestSuggestionInput = {
  interest_name: string;
  athlete_pct: number | null;
};

export type BuildSuggestedAnglesInput = {
  audience?: AthleteAudienceProfile | null;
  suggestedInterests: InterestSuggestionInput[];
  interestStrength: "strong" | "weak" | "unknown";
  industryKey: IndustryInterestKey | null;
  mappedCategories: string[];
  companyName: string;
  targetIndustryOrCategory: string | null;
  maxAngles?: number;
};

const STRONG_PCT = 6;
const MEDIUM_PCT = 3;
const COUNTRY_CONCENTRATION_PCT = 15;
const GENDER_SKEW_PCT = 55;

const industryBrandMap: Record<Exclude<IndustryInterestKey, null>, string[]> = {
  fitness: ["Nike", "Adidas", "Lululemon", "Under Armour", "Patagonia", "Gymshark", "Peloton", "Reebok"],
  apparel: ["Nike", "Adidas", "Lululemon", "Patagonia", "The North Face", "Carhartt", "H&M", "Zara"],
  camera: ["GoPro", "Canon", "Sony", "DJI", "Nikon", "Apple"],
  beverage: ["Red Bull", "Monster", "Gatorade", "Coca-Cola", "Starbucks"],
  automotive: ["Ford", "Toyota", "BMW", "Mercedes-Benz", "Red Bull"],
  gaming: ["PlayStation", "Xbox", "Nintendo", "Razer", "Logitech"],
  beauty: ["Sephora", "Glossier", "Fenty Beauty", "L'Oréal", "MAC"],
  travel: ["Airbnb", "Booking.com", "Delta", "United Airlines", "Patagonia"],
  food: ["Whole Foods", "Chipotle", "Starbucks", "McDonald's"],
  tech: ["Apple", "Samsung", "Google", "Microsoft", "Sony"],
  finance: ["American Express", "Visa", "Chase", "Mastercard"],
  family: ["Disney", "Target", "Walmart", "Carter's"],
  entertainment: ["Netflix", "Spotify", "Disney", "YouTube"],
  pets: ["Chewy", "Purina", "Pedigree", "Rover"],
};

const GEO_FOCUS_TOKENS: Array<{ token: string; labels: string[] }> = [
  { token: "australia", labels: ["australia"] },
  { token: "united states", labels: ["united states", "usa", "u.s.", "america"] },
  { token: "united kingdom", labels: ["united kingdom", "uk", "england", "britain"] },
  { token: "canada", labels: ["canada"] },
  { token: "germany", labels: ["germany"] },
  { token: "france", labels: ["france"] },
  { token: "japan", labels: ["japan"] },
  { token: "brazil", labels: ["brazil"] },
  { token: "mexico", labels: ["mexico"] },
  { token: "new zealand", labels: ["new zealand"] },
];

const DEMOGRAPHIC_RELEVANT_INDUSTRIES = new Set<Exclude<IndustryInterestKey, null>>([
  "fitness",
  "apparel",
  "beauty",
  "family",
]);

function normalizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function rowPercent(row: AudienceRow): number {
  return audiencePercentPoints(row.ig_audience_percent);
}

function rateAngleStrength(pct: number, brandRelevance: "high" | "medium" | "low"): "strong" | "medium" | "weak" {
  const relevanceHigh = brandRelevance === "high";
  if (pct >= STRONG_PCT && relevanceHigh) return "strong";
  if (pct >= STRONG_PCT || relevanceHigh) return "medium";
  if (pct >= MEDIUM_PCT || brandRelevance === "medium") return "medium";
  return "weak";
}

function strengthRank(strength: SuggestedPitchAngle["strength"]): number {
  if (strength === "strong") return 3;
  if (strength === "medium") return 2;
  return 1;
}

function capSuggestedAngles(angles: SuggestedPitchAngle[], maxAngles: number): SuggestedPitchAngle[] {
  return [...angles]
    .sort((a, b) => strengthRank(b.strength) - strengthRank(a.strength))
    .slice(0, maxAngles);
}

function mappedRelevance(interestName: string, mappedCategories: string[]): "high" | "medium" | "low" {
  const idx = mappedCategories.findIndex((c) => normalizeKey(c) === normalizeKey(interestName));
  if (idx === 0) return "high";
  if (idx > 0) return "medium";
  return "low";
}

function targetMentionsWomen(target: string | null, companyName: string): boolean {
  const hay = `${target ?? ""} ${companyName}`.toLowerCase();
  return /\b(women|woman|womens|women's|female|ladies)\b/.test(hay);
}

function extractGeoFocusHints(target: string | null, companyName: string): string[] {
  const hay = `${target ?? ""} ${companyName}`.toLowerCase();
  const hits = new Set<string>();
  for (const entry of GEO_FOCUS_TOKENS) {
    if (entry.labels.some((label) => hay.includes(label))) {
      hits.add(entry.token);
    }
  }
  return [...hits];
}

function countryMatchesGeoFocus(countryName: string, geoHints: string[]): boolean {
  if (!geoHints.length) return false;
  const normalized = normalizeKey(countryName);
  return geoHints.some((hint) => normalized.includes(hint) || hint.includes(normalized));
}

function normalizeGenderValue(label: string): "female" | "male" | "non_binary" | null {
  const text = normalizeKey(label);
  if (text.includes("female") || text.includes("woman")) return "female";
  if (text.includes("non") && text.includes("binary")) return "non_binary";
  if (text.includes("male")) return "male";
  return null;
}

function brandAlignsWithIndustry(brandName: string, industryKey: IndustryInterestKey | null): "high" | "medium" | "low" {
  if (!industryKey) return "low";
  const brands = industryBrandMap[industryKey] ?? [];
  const normalized = normalizeKey(brandName);
  if (brands.some((b) => normalizeKey(b) === normalized)) return "high";
  if (brands.some((b) => normalized.includes(normalizeKey(b)) || normalizeKey(b).includes(normalized))) {
    return "medium";
  }
  return "low";
}

function interestAnglesFromSuggestions(
  suggestions: InterestSuggestionInput[],
  mappedCategories: string[]
): SuggestedPitchAngle[] {
  return suggestions.slice(0, 3).map((s) => {
    const pct = s.athlete_pct ?? 0;
    const relevance = mappedRelevance(s.interest_name, mappedCategories);
    return {
      kind: "interest" as const,
      value: s.interest_name,
      strength: rateAngleStrength(pct, relevance),
      reason:
        pct > 0
          ? `${pct.toFixed(1)}% audience interest aligned with brand category`
          : "Mapped to recipient brand category",
    };
  });
}

function ageAnglesFromAudience(
  audience: AthleteAudienceProfile,
  industryKey: IndustryInterestKey | null
): SuggestedPitchAngle[] {
  const rows = [...(audience.age ?? [])].sort((a, b) => rowPercent(b) - rowPercent(a));
  if (!rows.length) return [];

  const percents = rows.map((row) => rowPercent(row));
  const baseline = percents.reduce((sum, pct) => sum + pct, 0) / percents.length;
  const relevance = industryKey && DEMOGRAPHIC_RELEVANT_INDUSTRIES.has(industryKey) ? "high" : "medium";

  const candidates = rows
    .map((row) => ({
      row,
      pct: rowPercent(row),
    }))
    .filter(({ pct }) => pct >= Math.max(baseline * 1.25, 12))
    .slice(0, 2);

  return candidates.map(({ row, pct }) => ({
    kind: "age" as const,
    value: String(row.audience_name ?? "").trim(),
    strength: rateAngleStrength(pct, relevance),
    reason: `${pct.toFixed(1)}% in ${row.audience_name} — above typical age-band baseline`,
  }));
}

function genderAnglesFromAudience(
  audience: AthleteAudienceProfile,
  industryKey: IndustryInterestKey | null,
  target: string | null,
  companyName: string
): SuggestedPitchAngle[] {
  const rows = [...(audience.gender ?? [])].sort((a, b) => rowPercent(b) - rowPercent(a));
  if (!rows.length) return [];

  const top = rows[0];
  const pct = rowPercent(top);
  if (pct < GENDER_SKEW_PCT) return [];

  const normalized = normalizeGenderValue(String(top.audience_name ?? ""));
  if (!normalized) return [];

  const womenFocused = targetMentionsWomen(target, companyName);
  let relevance: "high" | "medium" | "low" = "medium";
  if (womenFocused && normalized === "female") relevance = "high";
  else if (
    industryKey &&
    DEMOGRAPHIC_RELEVANT_INDUSTRIES.has(industryKey) &&
    (normalized === "female" || normalized === "male")
  ) {
    relevance = "high";
  }

  return [
    {
      kind: "gender",
      value: normalized,
      strength: rateAngleStrength(pct, relevance),
      reason: `${pct.toFixed(1)}% ${normalized} audience skew`,
    },
  ];
}

function countryAnglesFromAudience(
  audience: AthleteAudienceProfile,
  target: string | null,
  companyName: string
): SuggestedPitchAngle[] {
  const rows = [...(audience.countries ?? [])].sort((a, b) => rowPercent(b) - rowPercent(a));
  if (!rows.length) return [];

  const top = rows[0];
  const pct = rowPercent(top);
  const country = String(top.audience_name ?? "").trim();
  if (!country) return [];

  const geoHints = extractGeoFocusHints(target, companyName);
  const aligned = countryMatchesGeoFocus(country, geoHints);
  if (geoHints.length > 0) {
    if (!aligned && pct < COUNTRY_CONCENTRATION_PCT) return [];
  }

  const relevance: "high" | "medium" | "low" = aligned ? "high" : pct >= COUNTRY_CONCENTRATION_PCT ? "medium" : "low";
  if (!geoHints.length || aligned || pct >= COUNTRY_CONCENTRATION_PCT) {
    return [
      {
        kind: "country",
        value: country,
        strength: rateAngleStrength(pct, relevance),
        reason: aligned
          ? `${pct.toFixed(1)}% in ${country} — aligns with brand geography`
          : `${pct.toFixed(1)}% audience concentration in ${country}`,
      },
    ];
  }

  return [];
}

function brandAffinityAnglesFromAudience(
  audience: AthleteAudienceProfile,
  industryKey: IndustryInterestKey | null,
  companyName: string
): SuggestedPitchAngle[] {
  const recipient = normalizeKey(companyName);
  const rows = [...(audience.brands ?? [])]
    .filter((row) => normalizeKey(String(row.audience_name ?? "")) !== recipient)
    .sort((a, b) => rowPercent(b) - rowPercent(a));

  const angles: SuggestedPitchAngle[] = [];
  for (const row of rows) {
    const brand = String(row.audience_name ?? "").trim();
    if (!brand) continue;
    const pct = rowPercent(row);
    const relevance = brandAlignsWithIndustry(brand, industryKey);
    if (relevance === "low" && pct < MEDIUM_PCT) continue;
    angles.push({
      kind: "brand_affinity",
      value: brand,
      strength: rateAngleStrength(pct, relevance),
      reason:
        relevance === "high"
          ? `${pct.toFixed(1)}% follows ${brand} — peer brand in recipient category`
          : `${pct.toFixed(1)}% audience affinity for ${brand}`,
    });
    if (angles.length >= 3) break;
  }
  return angles;
}

export function buildSuggestedPitchAngles(input: BuildSuggestedAnglesInput): SuggestedPitchAngle[] {
  const maxAngles = Math.max(1, Math.min(input.maxAngles ?? 8, 8));
  const interestAngles = interestAnglesFromSuggestions(input.suggestedInterests, input.mappedCategories);

  if (!input.audience) {
    return capSuggestedAngles(interestAngles, maxAngles);
  }

  const angles: SuggestedPitchAngle[] = [
    ...interestAngles,
    ...ageAnglesFromAudience(input.audience, input.industryKey),
    ...genderAnglesFromAudience(
      input.audience,
      input.industryKey,
      input.targetIndustryOrCategory,
      input.companyName
    ),
    ...countryAnglesFromAudience(input.audience, input.targetIndustryOrCategory, input.companyName),
    ...brandAffinityAnglesFromAudience(input.audience, input.industryKey, input.companyName),
  ];

  return capSuggestedAngles(angles, maxAngles);
}
