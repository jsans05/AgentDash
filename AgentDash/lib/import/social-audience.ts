import type { AudienceCategoryEnum } from "@/lib/supabase/types";

export type ParsedSocialRow = {
  talent_id: string | null;
  name_raw: string | null;
  total_followers: number | null;
  avg_er_20p: number | null;
  total_lifetime_posts: number | null;
  ig_followers: number | null;
  avg_er_ig_20p: number | null;
  ig_lifetime_posts: number | null;
  tt_followers: number | null;
  avg_er_tt_20p: number | null;
  tt_lifetime_posts: number | null;
  fb_followers: number | null;
  avg_er_fb_20p: number | null;
  fb_lifetime_posts: number | null;
  x_followers: number | null;
  avg_er_x_20p: number | null;
  x_lifetime_posts: number | null;
};

export type ParsedAudienceRow = {
  talent_id: string | null;
  name_raw: string | null;
  audience_category: AudienceCategoryEnum | null;
  audience_name: string | null;
  ig_audience_percent: number | null;
  ig_audience_count: number | null;
  current_ig_following: number | null;
};

export type ImportRowFailure = {
  sheet: "Social Data" | "Audience Data";
  rowIndex: number;
  reason: string;
};

export type SheetImportSummary = {
  sheet: "Social Data" | "Audience Data";
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type ImportSummary = {
  sheets: SheetImportSummary[];
  failures: ImportRowFailure[];
};

const SOCIAL_HEADER_MAP: Record<string, string> = {
  name: "name_raw",
  "talent id": "talent_id",
  "total followers": "total_followers",
  "avg. er (20p)": "avg_er_20p",
  "avg er (20p)": "avg_er_20p",
  "total lifetime posts": "total_lifetime_posts",
  "ig followers": "ig_followers",
  "avg. er (ig, 20p)": "avg_er_ig_20p",
  "avg er (ig, 20p)": "avg_er_ig_20p",
  "ig lifetime posts": "ig_lifetime_posts",
  "tt followers": "tt_followers",
  "avg. er (tt, 20p)": "avg_er_tt_20p",
  "avg er (tt, 20p)": "avg_er_tt_20p",
  "tt lifetime posts": "tt_lifetime_posts",
  "fb followers": "fb_followers",
  "avg. er (fb, 20p)": "avg_er_fb_20p",
  "avg er (fb, 20p)": "avg_er_fb_20p",
  "fb lifetime posts": "fb_lifetime_posts",
  "x followers": "x_followers",
  "avg. er (x, 20p)": "avg_er_x_20p",
  "avg er (x, 20p)": "avg_er_x_20p",
  "x lifetime posts": "x_lifetime_posts",
};

const AUDIENCE_HEADER_MAP: Record<string, string> = {
  name: "name_raw",
  "talent id": "talent_id",
  "audience category": "audience_category",
  "audience name": "audience_name",
  "% ig audience": "ig_audience_percent",
  "# ig audience": "ig_audience_count",
  "current ig following": "current_ig_following",
};

const VALID_AUDIENCE_CATEGORIES: AudienceCategoryEnum[] = [
  "Brands",
  "Cities",
  "Combined_Age",
  "Countries",
  "Ethnicity",
  "Gender",
  "Interests",
  "States",
];

function normalizeHeaders<T extends Record<string, unknown>>(
  row: T,
  map: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = String(rawKey).toLowerCase().trim();
    const normalizedKey = map[key] ?? rawKey;
    out[normalizedKey] = value;
  }
  return out;
}

export function normalizeSocialRow(row: Record<string, unknown>): ParsedSocialRow {
  const r = normalizeHeaders(row, SOCIAL_HEADER_MAP);
  return {
    talent_id: toStringOrNull(r.talent_id),
    name_raw: toStringOrNull(r.name_raw),
    total_followers: parseNumber(r.total_followers),
    avg_er_20p: parsePercentLike(r.avg_er_20p),
    total_lifetime_posts: parseNumber(r.total_lifetime_posts),
    ig_followers: parseNumber(r.ig_followers),
    avg_er_ig_20p: parsePercentLike(r.avg_er_ig_20p),
    ig_lifetime_posts: parseNumber(r.ig_lifetime_posts),
    tt_followers: parseNumber(r.tt_followers),
    avg_er_tt_20p: parsePercentLike(r.avg_er_tt_20p),
    tt_lifetime_posts: parseNumber(r.tt_lifetime_posts),
    fb_followers: parseNumber(r.fb_followers),
    avg_er_fb_20p: parsePercentLike(r.avg_er_fb_20p),
    fb_lifetime_posts: parseNumber(r.fb_lifetime_posts),
    x_followers: parseNumber(r.x_followers),
    avg_er_x_20p: parsePercentLike(r.avg_er_x_20p),
    x_lifetime_posts: parseNumber(r.x_lifetime_posts),
  };
}

export function normalizeAudienceRow(row: Record<string, unknown>): ParsedAudienceRow {
  const r = normalizeHeaders(row, AUDIENCE_HEADER_MAP);
  const categoryRaw = toStringOrNull(r.audience_category);
  const category = normalizeAudienceCategory(categoryRaw);

  return {
    talent_id: toStringOrNull(r.talent_id),
    name_raw: toStringOrNull(r.name_raw),
    audience_category: category,
    audience_name: toStringOrNull(r.audience_name),
    ig_audience_percent: parsePercentLike(r.ig_audience_percent),
    ig_audience_count: parseNumber(r.ig_audience_count),
    current_ig_following: parseNumber(r.current_ig_following),
  };
}

export function normalizeAudienceCategory(
  value: string | null
): AudienceCategoryEnum | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, "_");
  switch (v) {
    case "brands":
      return "Brands";
    case "cities":
      return "Cities";
    case "combined_age":
    case "combinedage":
      return "Combined_Age";
    case "countries":
      return "Countries";
    case "ethnicity":
      return "Ethnicity";
    case "gender":
      return "Gender";
    case "interests":
      return "Interests";
    case "states":
      return "States";
    default:
      return null;
  }
}

export function validateAudienceCategory(
  category: AudienceCategoryEnum | null
): { ok: boolean; reason?: string } {
  if (!category) {
    return { ok: false, reason: "Missing or invalid Audience Category" };
  }
  if (!VALID_AUDIENCE_CATEGORIES.includes(category)) {
    return { ok: false, reason: `Audience Category "${category}" is not allowed` };
  }
  return { ok: true };
}

export function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && !isNaN(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, "");
  const n = Number(cleaned);
  if (!isFinite(n)) return null;
  return n;
}

export function parsePercentLike(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && !isNaN(value)) return value;
  const s = String(value).trim();
  if (!s) return null;
  const hadPercentSign = s.includes("%");
  const cleaned = s.replace(/,/g, "").replace(/%/g, "");
  const n = Number(cleaned);
  if (!isFinite(n)) return null;

  // Heuristic:
  // - If spreadsheet provides fractional percentages like 0.8% or 0.8 (meaning 80%),
  //   the display should show 80%.
  // - If it's already a "percent" number like 80, leave it unchanged.
  if (n >= 0 && n < 1.0000001 && (hadPercentSign || s.includes("percent") || s.includes("Percent"))) {
    return n * 100;
  }

  return n;
}

export function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

