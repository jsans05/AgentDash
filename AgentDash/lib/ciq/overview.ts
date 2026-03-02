/**
 * Overview parsing from CreatorIQ snapshots only.
 * snapshot_type "accounts" | "audience". No live CIQ calls.
 * Defensive: never throw on missing fields.
 */

/** Coerce raw snapshot value to object (handles JSON string from DB). */
export function coerceJson(raw: unknown): Record<string, unknown> | unknown[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown> | unknown[];
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown> | unknown[];
  return null;
}

function normalizeNetwork(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

export type OverviewAccount = {
  network: string;
  fullName: string;
  networkUser: string;
  followersCount: number;
  viewsCount: number;
  logoURL: string | null;
  socialNetworkId: string;
};

export type OverviewTotals = {
  totalFollowers: number;
  totalViews: number;
  accountCount: number;
};

export type GenderSlice = { label: string; value: number };

export type AgeBucket = { label: string; value: number };

const AGE_ORDER = ["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"];

const AGE_KEYS: Record<string, string> = {
  "13_17": "13–17",
  "13-17": "13–17",
  "18_24": "18–24",
  "18-24": "18–24",
  "25_34": "25–34",
  "25-34": "25–34",
  "35_44": "35–44",
  "35-44": "35–44",
  "45_54": "45–54",
  "45-54": "45–54",
  "55_64": "55–64",
  "55-64": "55–64",
  "65_plus": "65+",
  "65+": "65+",
};

export type AudienceData = {
  gender: GenderSlice[];
  age: AgeBucket[];
  locations?: LocationsData | null;
};

export type InterestItem = { name: string; value: number };

export type LocationRow = { name: string; value: number };

export type LocationsData = {
  countries: LocationRow[];
  states: LocationRow[];
  cities: LocationRow[];
};

function num(v: unknown): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function str(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function pct(v: unknown): number | null {
  const n = num(v);
  if (n < 0) return null;
  if (n <= 1) return Math.round(n * 1000) / 10;
  return Math.round(n * 10) / 10;
}

/** Get accounts array from accounts snapshot raw. Handles: array, or { "publisherId": [...] }, after coerceJson. */
function getAccountsArrayFromObj(obj: Record<string, unknown> | unknown[] | null): unknown[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  const r = obj as Record<string, unknown>;
  for (const key of ["accounts", "social_accounts", "data"]) {
    const v = r[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.accounts)) return o.accounts;
      if (Array.isArray(o.social_accounts)) return o.social_accounts;
    }
  }
  const keys = Object.keys(r);
  if (keys.length >= 1) {
    const firstKey = keys[0];
    const v = r[firstKey];
    if (Array.isArray(v)) return v;
  }
  for (const key of keys) {
    const v = r[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      const first = v[0] as Record<string, unknown>;
      if (first.Network != null || first.FollowersCount != null) return v;
    }
  }
  return [];
}

/** Parse accounts from snapshot raw (handles string or object, and { "id": [...] } shape); exclude web. */
export function parseAccounts(accountsRaw: unknown): OverviewAccount[] {
  const obj = coerceJson(accountsRaw);
  const arr = Array.isArray(obj)
    ? obj
    : obj && typeof obj === "object"
      ? getAccountsArrayFromObj(obj as Record<string, unknown>)
      : [];
  const out: OverviewAccount[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const network = str(o.Network ?? o.network ?? o.platform ?? "").toLowerCase();
    if (network === "web") continue;
    out.push({
      network: str(o.Network ?? o.network ?? o.platform ?? "unknown"),
      fullName: str(o.FullName ?? o.full_name ?? o.name ?? ""),
      networkUser: str(o.NetworkUser ?? o.username ?? o.handle ?? ""),
      followersCount: num(o.FollowersCount ?? o.followers ?? o.follower_count),
      viewsCount: num(o.ViewsCount ?? o.views ?? o.views_count),
      logoURL: str(o.LogoURL ?? o.logo_url ?? o.avatar_url ?? "") || null,
      socialNetworkId: str(o.SocialNetworkId ?? o.social_network_id ?? o.id ?? ""),
    });
  }
  return out;
}

/** Totals from accounts: sum FollowersCount, sum ViewsCount, count. Exclude web, nulls=0. */
export function getTotals(accounts: OverviewAccount[]): OverviewTotals {
  let totalFollowers = 0;
  let totalViews = 0;
  for (const a of accounts) {
    totalFollowers += a.followersCount;
    totalViews += a.viewsCount;
  }
  return {
    totalFollowers,
    totalViews,
    accountCount: accounts.length,
  };
}

/** Primary account = single account with highest FollowersCount (null=0, exclude web). */
export function getPrimaryAccount(accounts: OverviewAccount[]): OverviewAccount | null {
  if (accounts.length === 0) return null;
  let best = accounts[0];
  for (let i = 1; i < accounts.length; i++) {
    if (accounts[i].followersCount > best.followersCount) best = accounts[i];
  }
  return best;
}

/** Parse gender (Male/Female) from audience blob. */
function parseGenderFromAudience(raw: Record<string, unknown>): GenderSlice[] {
  const out: GenderSlice[] = [];
  const candidates = [
    raw.gender,
    raw.gender_breakdown,
    (raw.demographics as Record<string, unknown>)?.gender,
    raw.Gender,
  ].filter(Boolean);
  let obj: Record<string, unknown> | null = null;
  for (const c of candidates) {
    if (c && typeof c === "object" && !Array.isArray(c)) {
      obj = c as Record<string, unknown>;
      break;
    }
  }
  if (!obj) {
    const male = pct(raw.male ?? (raw.demographics as Record<string, unknown>)?.male ?? (raw.Gender as Record<string, unknown>)?.Male);
    const female = pct(raw.female ?? (raw.demographics as Record<string, unknown>)?.female ?? (raw.Gender as Record<string, unknown>)?.Female);
    if (male != null) out.push({ label: "Male", value: male });
    if (female != null) out.push({ label: "Female", value: female });
    return out;
  }
  const labels = [
    { key: "male", label: "Male" },
    { key: "female", label: "Female" },
    { key: "Male", label: "Male" },
    { key: "Female", label: "Female" },
    { key: "other", label: "Other" },
  ];
  const seen = new Set<string>();
  for (const { key: k, label } of labels) {
    if (seen.has(label)) continue;
    const v = pct(obj[k]);
    if (v != null) {
      out.push({ label, value: v });
      seen.add(label);
    }
  }
  return out;
}

/** Parse age buckets (13–17 … 65+) from audience blob. */
function parseAgeFromAudience(raw: Record<string, unknown>): AgeBucket[] {
  const out: AgeBucket[] = [];
  const sources = [
    raw.age,
    raw.age_breakdown,
    (raw.demographics as Record<string, unknown>)?.age,
    raw.Age,
    raw.AgeBreakdown,
  ].filter(Boolean);
  let map: Record<string, unknown> = raw;
  for (const s of sources) {
    if (s && typeof s === "object" && !Array.isArray(s)) {
      map = s as Record<string, unknown>;
      break;
    }
  }
  const topN = map.AudienceAge_TopN ?? map.Age_TopN;
  const share = map.AudienceAge_Share ?? map.Age_Share;
  if (Array.isArray(topN) && Array.isArray(share)) {
    const len = Math.min(topN.length, share.length);
    for (let i = 0; i < len; i++) {
      const name = str(topN[i]);
      const value = pct(share[i]);
      if (name && value != null) out.push({ label: name, value });
    }
  }
  for (const [key, label] of Object.entries(AGE_KEYS)) {
    const v = pct(map[key]);
    if (v != null && !out.some((x) => x.label === label)) out.push({ label, value: v });
  }
  for (const [k, v] of Object.entries(map)) {
    if (pct(v) == null) continue;
    const label = AGE_KEYS[k] ?? k.replace(/_/g, "–");
    if (!out.some((x) => x.label === label)) out.push({ label, value: pct(v)! });
  }
  const orderIdx = (l: string) => {
    const i = AGE_ORDER.indexOf(l);
    return i === -1 ? AGE_ORDER.length : i;
  };
  return out.sort((a, b) => orderIdx(a.label) - orderIdx(b.label));
}

/** Get audience nodes array from audience snapshot. Shape: { Audience: { "3745523": {...}, ... } } or nested under data/raw_json. */
export function getAudienceNodes(audienceRaw: unknown): Record<string, unknown>[] {
  const obj = coerceJson(audienceRaw);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const r = obj as Record<string, unknown>;
  const audienceObj =
    (r.Audience as Record<string, unknown> | undefined) ??
    (r.data as Record<string, unknown> | undefined)?.Audience ??
    (r.raw_json as Record<string, unknown> | undefined)?.Audience ??
    null;
  if (!audienceObj || typeof audienceObj !== "object" || Array.isArray(audienceObj))
    return [];
  return Object.values(audienceObj).filter(
    (v): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v)
  );
}

/** Single object to parse audience from (snapshot may wrap in .data, ._embedded, or ID-keyed). */
export function getAudienceRoot(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const data = raw.data && typeof raw.data === "object" ? raw.data : null;
  const embedded = raw._embedded && typeof raw._embedded === "object" ? (raw._embedded as Record<string, unknown>) : null;
  const demographics = embedded?.demographics && typeof embedded.demographics === "object" ? embedded.demographics : null;
  const audience = embedded?.audience && typeof embedded.audience === "object" ? embedded.audience : null;
  if (data ?? demographics ?? audience ?? embedded) {
    return (data ?? demographics ?? audience ?? embedded) as Record<string, unknown>;
  }
  // Backend shape: root is keyed by ID e.g. "3745523" -> { Locations: [], Gender?, Age?, ... }
  const keys = Object.keys(raw);
  if (keys.length >= 1) {
    const firstKey = keys[0];
    const val = raw[firstKey];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (obj.Locations != null || obj.Gender != null || obj.demographics != null) {
        return obj;
      }
    }
    for (const k of keys) {
      const v = raw[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.Locations) || o.Gender != null || o.demographics != null) {
          return o;
        }
      }
    }
  }
  return raw as Record<string, unknown>;
}

/** Get audience blob for account from audience snapshot. Match by normalize(Network) + String(SocialNetworkId) on node.Demographics. */
function getAudienceBlobForAccount(
  account: OverviewAccount,
  audienceRaw: unknown
): Record<string, unknown> | null {
  const nodes = getAudienceNodes(audienceRaw);
  const accountNet = normalizeNetwork(account.network);
  const accountId = String(account.socialNetworkId ?? "");
  for (const node of nodes) {
    const demo = node.Demographics ?? node.demographics;
    if (!demo || typeof demo !== "object") continue;
    const d = demo as Record<string, unknown>;
    const nodeNet = normalizeNetwork(d.Network ?? d.network);
    const nodeId = String(d.SocialNetworkId ?? d.social_network_id ?? d.id ?? "");
    if (accountNet === nodeNet && accountId === nodeId) return node;
  }
  // Fallback: legacy root key / array matching
  const rawObj = coerceJson(audienceRaw) as Record<string, unknown> | null;
  if (!rawObj || Array.isArray(rawObj)) return null;
  const root = getAudienceRoot(rawObj);
  const key = `${accountNet}_${accountId}`;
  const key2 = accountNet;
  if (root[key] && typeof root[key] === "object") return root[key] as Record<string, unknown>;
  if (root[key2] && typeof root[key2] === "object") return root[key2] as Record<string, unknown>;
  const arr = root.audiences ?? root.accounts;
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const d = o.Demographics ?? o.demographics;
      const n = d && typeof d === "object" ? normalizeNetwork((d as Record<string, unknown>).Network ?? (d as Record<string, unknown>).network) : normalizeNetwork(o.Network ?? o.network);
      const id = d && typeof d === "object" ? String((d as Record<string, unknown>).SocialNetworkId ?? (d as Record<string, unknown>).social_network_id ?? (d as Record<string, unknown>).id ?? "") : str(o.SocialNetworkId ?? o.social_network_id ?? o.id ?? "");
      if (accountNet === n && accountId === id) return o as Record<string, unknown>;
    }
  }
  return null;
}

/** Audience data for one account (match by Network + SocialNetworkId). Optional primaryAccount: use global blob for primary when no per-account match. */
export function getAudienceForAccount(
  account: OverviewAccount,
  audienceRaw: unknown,
  primaryAccount?: OverviewAccount | null
): AudienceData | null {
  if (audienceRaw == null) return null;
  let blob = getAudienceBlobForAccount(account, audienceRaw);
  if (!blob && primaryAccount != null) {
    const isPrimary = account.network === primaryAccount.network && account.socialNetworkId === primaryAccount.socialNetworkId;
    if (isPrimary) {
      const rawObj = coerceJson(audienceRaw) as Record<string, unknown> | null;
      const root = rawObj ? getAudienceRoot(rawObj) : {};
      const hasDemographics =
        root.demographics != null ||
        root.gender != null ||
        root.age != null ||
        (root.Gender && typeof root.Gender === "object") ||
        (root.Age && typeof root.Age === "object") ||
        (root as Record<string, unknown>).gender_breakdown != null ||
        (root as Record<string, unknown>).age_breakdown != null;
      if (hasDemographics) blob = root;
    }
  }
  if (!blob) return null;
  const gender = parseGenderFromAudience(blob);
  const age = parseAgeFromAudience(blob);
  const locations = parseLocationsFromAudience(blob);
  const hasLocations = locations.countries.length > 0 || locations.states.length > 0 || locations.cities.length > 0;
  if (gender.length === 0 && age.length === 0 && !hasLocations) return null;
  return {
    gender,
    age,
    locations: hasLocations ? locations : undefined,
  };
}

/** Interests from audience blob (root). Supports array of objects or Interests_TopN + Interests_Share. */
export function parseInterestsFromAudience(raw: Record<string, unknown>): InterestItem[] {
  const topN = raw.Interests_TopN ?? raw.Interest_TopN ?? raw.interests_top_n;
  const share = raw.Interests_Share ?? raw.Interest_Share ?? raw.interests_share;
  if (Array.isArray(topN) && Array.isArray(share)) {
    const out: InterestItem[] = [];
    const len = Math.min(topN.length, share.length);
    for (let i = 0; i < len; i++) {
      const name = str(topN[i]);
      const value = Math.round((pct(share[i]) ?? 0) * 10) / 10;
      if (name) out.push({ name, value });
    }
    return out.sort((a, b) => b.value - a.value);
  }
  const keys = ["interests", "interest_categories", "audience_interests", "top_interests"];
  let arr: unknown[] = [];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) {
      arr = v;
      break;
    }
  }
  const out: InterestItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name ?? o.category ?? o.label ?? o.Name);
    const value = pct(o.percentage ?? o.value ?? o.Share);
    if (name && value != null) out.push({ name, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Brands from audience blob (root). Supports array of objects or Brands_TopN + Brands_Share. */
export function parseBrandsFromAudience(raw: Record<string, unknown>): InterestItem[] {
  const topN = raw.Brands_TopN ?? raw.Brand_TopN ?? raw.brands_top_n;
  const share = raw.Brands_Share ?? raw.Brand_Share ?? raw.brands_share;
  if (Array.isArray(topN) && Array.isArray(share)) {
    const out: InterestItem[] = [];
    const len = Math.min(topN.length, share.length);
    for (let i = 0; i < len; i++) {
      const name = str(topN[i]);
      const value = Math.round((pct(share[i]) ?? 0) * 10) / 10;
      if (name) out.push({ name, value });
    }
    return out.sort((a, b) => b.value - a.value);
  }
  const keys = ["brands", "top_brands", "brand_affinity"];
  let arr: unknown[] = [];
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) {
      arr = v;
      break;
    }
  }
  const out: InterestItem[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = str(o.name ?? o.brand ?? o.label ?? o.Name);
    const value = pct(o.percentage ?? o.value ?? o.Share);
    if (name && value != null) out.push({ name, value });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Locations: FullLocations (AudienceCountry_TopN etc + Share) or Locations[] as countries. */
function extractLocationRows(
  raw: Record<string, unknown>,
  keyTopN: string,
  keyShare: string
): LocationRow[] {
  const topN = raw[keyTopN];
  const share = raw[keyShare];
  if (Array.isArray(topN) && Array.isArray(share)) {
    const out: LocationRow[] = [];
    const len = Math.min(topN.length, share.length);
    for (let i = 0; i < len; i++) {
      const name = str(topN[i]);
      const value = Math.round(num(share[i]) * 10) / 10;
      if (name) out.push({ name, value });
    }
    return out.sort((a, b) => b.value - a.value);
  }
  if (Array.isArray(topN)) {
    return topN
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const o = item as Record<string, unknown>;
        const name = str(o.name ?? o.country ?? o.region ?? o.label ?? o);
        const value = Math.round((pct(o.Share ?? o.percentage ?? o.value) ?? 0) * 10) / 10;
        return name ? { name, value } : null;
      })
      .filter((x): x is LocationRow => x != null)
      .sort((a, b) => b.value - a.value);
  }
  return [];
}

export function parseLocationsFromAudience(raw: Record<string, unknown>): LocationsData {
  const root = getAudienceRoot(raw);
  const fullLoc = root.FullLocations ?? root.full_locations;
  const locRoot =
    fullLoc && typeof fullLoc === "object" && !Array.isArray(fullLoc)
      ? (fullLoc as Record<string, unknown>)
      : root;
  let countries = extractLocationRows(locRoot, "AudienceCountry_TopN", "AudienceCountry_Share");
  if (countries.length === 0) countries = extractLocationRows(root, "Country_TopN", "Country_Share");
  if (countries.length === 0) {
    const loc = locRoot.Locations ?? locRoot.locations ?? locRoot.countries ?? root.Locations ?? root.locations ?? root.countries;
    if (Array.isArray(loc)) {
      countries = loc
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const o = item as Record<string, unknown>;
          const name = str(o.Region ?? o.name ?? o.country ?? o.region ?? o.label ?? o);
          const value = Math.round((num(o.RegionPercentage ?? o.Share ?? o.percentage ?? o.value) ?? 0) * 10) / 10;
          return name ? { name, value } : null;
        })
        .filter((x): x is LocationRow => x != null)
        .sort((a, b) => b.value - a.value);
    }
  }
  let states = extractLocationRows(locRoot, "AudienceState_TopN", "AudienceState_Share");
  if (states.length === 0) states = extractLocationRows(locRoot, "State_TopN", "State_Share");
  let cities = extractLocationRows(locRoot, "AudienceCity_TopN", "AudienceCity_Share");
  if (cities.length === 0) cities = extractLocationRows(locRoot, "City_TopN", "City_Share");
  return { countries, states, cities };
}

/** Whether snapshot is older than 30 days. */
export function isSnapshotStale(fetchedAt: string): boolean {
  const d = new Date(fetchedAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return d < cutoff;
}
