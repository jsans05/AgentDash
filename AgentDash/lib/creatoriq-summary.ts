/**
 * Safe extraction of CreatorIQ audience/accounts raw JSON into summary shapes.
 * Handles missing sections and varying API response structures.
 */

type UnknownRecord = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return !Number.isNaN(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** Try multiple keys in order; return first defined value. */
function first<T>(obj: UnknownRecord, keys: string[], cast: (v: unknown) => T | null): T | null {
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = cast(obj[k]);
    if (v != null) return v;
  }
  return null;
}

/** Normalize percentage to 0–100 (API may return 0–1 or 0–100). */
function pct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  if (n <= 1 && n >= 0) return Math.round(n * 1000) / 10;
  if (n >= 0 && n <= 100) return Math.round(n * 10) / 10;
  return null;
}

export type GenderSlice = { label: string; value: number; fill?: string };

export function parseGender(raw: UnknownRecord): GenderSlice[] {
  const out: GenderSlice[] = [];
  const candidates = [
    raw.gender,
    raw.gender_breakdown,
    raw.demographics?.valueOf && (raw.demographics as UnknownRecord).gender,
    (raw.demographics as UnknownRecord)?.gender_breakdown,
  ].filter(Boolean) as UnknownRecord[];

  const obj = candidates.find((c) => typeof c === "object" && c !== null && !Array.isArray(c)) as UnknownRecord | undefined;
  if (!obj) {
    const male = pct(raw.male) ?? pct((raw.demographics as UnknownRecord)?.male);
    const female = pct(raw.female) ?? pct((raw.demographics as UnknownRecord)?.female);
    if (male != null) out.push({ label: "Male", value: male });
    if (female != null) out.push({ label: "Female", value: female });
    return out;
  }

  const labels: { key: string; label: string }[] = [
    { key: "male", label: "Male" },
    { key: "female", label: "Female" },
    { key: "other", label: "Other" },
    { key: "unknown", label: "Unknown" },
  ];
  for (const { key, label } of labels) {
    const v = pct(obj[key]);
    if (v != null && v >= 0) out.push({ label, value: v });
  }
  return out;
}

/** Age buckets in display order. Keys we look for in API (snake_case or camelCase). */
const AGE_BUCKET_KEYS = [
  "under_18",
  "under18",
  "<18",
  "18_24",
  "18-24",
  "25_34",
  "25-34",
  "35_44",
  "35-44",
  "45_64",
  "45-64",
  "65_plus",
  "65+",
  "65_and_over",
] as const;

const AGE_BUCKET_LABELS: Record<string, string> = {
  under_18: "< 18",
  under18: "< 18",
  "<18": "< 18",
  "18_24": "18-24",
  "18-24": "18-24",
  "25_34": "25-34",
  "25-34": "25-34",
  "35_44": "35-44",
  "35-44": "35-44",
  "45_64": "45-64",
  "45-64": "45-64",
  "65_plus": "65+",
  "65+": "65+",
  "65_and_over": "65+",
};

export type AgeBucket = { label: string; value: number };

export function parseAge(raw: UnknownRecord): AgeBucket[] {
  const out: AgeBucket[] = [];
  const sources = [
    raw.age,
    raw.age_breakdown,
    raw.age_distribution,
    raw.demographics?.valueOf && (raw.demographics as UnknownRecord).age,
    (raw.demographics as UnknownRecord)?.age_breakdown,
  ].filter(Boolean) as UnknownRecord[];

  const obj = sources.find((s) => typeof s === "object" && s !== null && !Array.isArray(s)) as UnknownRecord | undefined;
  const map = obj ?? raw;

  const order = ["< 18", "18-24", "25-34", "35-44", "45-64", "65+"];
  const seen = new Set<string>();

  for (const [key, label] of Object.entries(AGE_BUCKET_LABELS)) {
    const v = pct(map[key]);
    if (v != null && v >= 0) {
      out.push({ label, value: v });
      seen.add(label);
    }
  }
  for (const k of Object.keys(map)) {
    const v = pct(map[k]);
    if (v == null || v < 0) continue;
    const label = AGE_BUCKET_LABELS[k] ?? k.replace(/_/g, "-");
    if (!seen.has(label)) {
      out.push({ label, value: v });
      seen.add(label);
    }
  }

  const orderIdx = (label: string) => {
    const i = order.indexOf(label);
    return i === -1 ? order.length : i;
  };
  return out.sort((a, b) => orderIdx(a.label) - orderIdx(b.label));
}

export type LocationItem = { name: string; value: number };

export function parseLocations(
  raw: UnknownRecord,
  kind: "countries" | "states" | "cities"
): LocationItem[] {
  const keys =
    kind === "countries"
      ? ["countries", "top_countries", "country_breakdown", "locations"]
      : kind === "states"
        ? ["states", "us_states", "top_states", "state_breakdown"]
        : ["cities", "top_cities", "city_breakdown"];
  let arr: unknown[] = [];
  for (const key of keys) {
    const v = raw[key] ?? (raw.demographics as UnknownRecord)?.[key];
    if (Array.isArray(v)) {
      arr = v;
      break;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      arr = Object.entries(v as Record<string, unknown>).map(([name, val]) => ({
        name,
        percentage: num(val) ?? 0,
        value: num(val) ?? 0,
      }));
      break;
    }
  }
  const out: LocationItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as UnknownRecord;
    const name = str(o.name ?? o.country ?? o.region ?? o.label);
    const value = pct(o.percentage ?? o.value ?? o.audience_percentage);
    if (name && value != null) out.push({ name, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

export type InterestItem = { name: string; value: number };

export function parseInterests(raw: UnknownRecord): InterestItem[] {
  const keys = ["interests", "interest_categories", "audience_interests", "top_interests", "interest_breakdown"];
  let arr: unknown[] = [];
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      arr = v;
      break;
    }
  }
  const out: InterestItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as UnknownRecord;
    const name = str(o.name ?? o.category ?? o.label ?? o.interest);
    const value = pct(o.percentage ?? o.value ?? o.audience_percentage);
    if (name && value != null) out.push({ name, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

export type EngagementPlatform = { platform: string; label: string; value: number };

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Get accounts array from root (handles { "publisherId": [...] } CreatorIQ shape). */
function getAccountsArray(accountsRaw: UnknownRecord): unknown[] {
  const data = (accountsRaw.data ?? accountsRaw._embedded) as UnknownRecord | undefined;
  if (Array.isArray(accountsRaw.accounts)) return accountsRaw.accounts;
  if (Array.isArray(accountsRaw.social_accounts)) return accountsRaw.social_accounts;
  if (data && Array.isArray(data.accounts)) return data.accounts;
  if (data && Array.isArray((data as UnknownRecord).social_accounts)) return (data as UnknownRecord).social_accounts as unknown[];
  if (Array.isArray(accountsRaw)) return accountsRaw;
  for (const key of Object.keys(accountsRaw)) {
    const v = accountsRaw[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      const first = v[0] as UnknownRecord;
      if (first.Network != null || first.network != null || first.FollowersCount != null || first.followers != null)
        return v;
    }
  }
  return [];
}

export function parseEngagementFromAccounts(accountsRaw: UnknownRecord): EngagementPlatform[] {
  const accounts = getAccountsArray(accountsRaw);
  const out: EngagementPlatform[] = [];
  for (const acc of accounts) {
    if (!acc || typeof acc !== "object") continue;
    const o = acc as UnknownRecord;
    const platform = str(o.Network ?? o.platform ?? o.network ?? o.type) ?? "Unknown";
    let rate = pct(o.EngagementRate ?? o.engagement_rate ?? o.engagement ?? o.engagementRate);
    if (rate == null) {
      const followers = num(o.FollowersCount ?? o.followers ?? o.follower_count);
      const likes = num(o.LikesCount ?? o.likes_count ?? o.likes);
      const comments = num(o.CommentsCount ?? o.comments_count ?? o.comments);
      if (followers != null && followers > 0 && (likes != null || comments != null)) {
        const total = (likes ?? 0) + (comments ?? 0);
        rate = Math.round((total / followers) * 10000) / 100;
      }
    }
    if (rate != null && rate >= 0) {
      out.push({
        platform: platform.toLowerCase(),
        label: PLATFORM_LABELS[platform.toLowerCase()] ?? platform,
        value: rate,
      });
    }
  }
  return out;
}

export type TopPostItem = { platform: string; imageUrl?: string; label?: string };

export function parseTopPosts(raw: UnknownRecord): TopPostItem[] {
  const keys = ["top_posts", "recent_posts", "posts", "top_content"];
  let arr: unknown[] = [];
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      arr = v;
      break;
    }
  }
  const out: TopPostItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as UnknownRecord;
    const platform = str(o.platform ?? o.network) ?? "";
    const imageUrl = str(o.image_url ?? o.thumbnail ?? o.imageUrl ?? o.thumbnail_url);
    const label = str(o.caption ?? o.title ?? o.label);
    out.push({ platform, imageUrl: imageUrl ?? undefined, label: label ?? undefined });
  }
  return out;
}

function orFirst<T>(a: T[], b: T[]): T[] {
  return a.length ? a : b;
}

/** One place to get audience summary from latest audience snapshot raw_json. */
export function getAudienceSummary(raw: UnknownRecord) {
  let root = (raw.data && typeof raw.data === "object" ? raw.data : raw) as UnknownRecord;
  if (Array.isArray(root)) root = (root[0] && typeof root[0] === "object" ? root[0] : raw) as UnknownRecord;
  const embedded = root._embedded as UnknownRecord | undefined;
  let audience: UnknownRecord = root;
  const from = (v: unknown): UnknownRecord | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
  const fromArr = (v: unknown): UnknownRecord | null =>
    Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0] as UnknownRecord) : null;
  audience =
    from(root.audience) ??
    from(embedded?.audience) ??
    fromArr(embedded?.audience) ??
    from(embedded?.demographics) ??
    root;
  const base = audience;
  return {
    gender: orFirst(parseGender(base), parseGender(root)),
    age: orFirst(parseAge(base), parseAge(root)),
    countries: orFirst(parseLocations(base, "countries"), parseLocations(root, "countries")),
    states: orFirst(parseLocations(base, "states"), parseLocations(root, "states")),
    cities: orFirst(parseLocations(base, "cities"), parseLocations(root, "cities")),
    interests: orFirst(parseInterests(base), parseInterests(root)),
  };
}
