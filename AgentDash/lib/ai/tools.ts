import { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import { getTaxonomyBySport } from "@/lib/taxonomy";
import { buildAthleteIntelligencePayload } from "@/lib/ai/retrieval";
import { canonicalInterestByNormalized } from "@/lib/industry-interest-map";
import {
  audiencePercentPoints,
  fmtPct,
  getAthleteAudienceProfile,
  normalizeIgAudiencePercentToFraction,
} from "@/lib/athlete-data";
import {
  renderGroupOutreachEmailMarkdown,
  renderSingleAthleteOutreachEmailMarkdown,
  validateGroupOutreachEmailInput,
  validateSingleAthleteOutreachEmailInput,
} from "@/lib/ai/email-templates";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";

/** Hardcoded roster sport values for "find athletes for [company]" STEP 2 (must match prompt in chat route). */
export const FIND_ATHLETES_FOR_COMPANY_SPORTS = [
  "BMX",
  "BMX Racing",
  "Cycling",
  "Diving",
  "Kitesurfing",
  "Lifestyle - Breakdancing",
  "Lifestyle - Broadcast",
  "Lifestyle - Chef",
  "Lifestyle - Personality",
  "Marathon/Half Marathon",
  "Motorsports/Two Wheel - Road Race",
  "Motorsports/Two Wheel - Supercross/Motocross",
  "Motorsports/Four Wheel - Off Road",
  "Motorsports/Four Wheel - Drag Racer",
  "Motorsports/Four Wheel - Indy Car/F1",
  "Motorsports/Four Wheel Racing Academy/F1",
  "Motorsports/Two Wheel - Freestyle Moto",
  "Motorsports/Two Wheel - Legends",
  "Outdoor - Adventurer",
  "Outdoor - Climbing",
  "Outdoor - Kayak",
  "Outdoor - Mountain Bike",
  "Outdoor - Mountain Bike/Lifestyle - Personality",
  "Outdoor - Rowing",
  "Outdoor - Swimming",
  "Skate",
  "Skateboard",
  "Snow - Ski",
  "Snow - Ski Alpine",
  "Snow - Snowboard",
  "Softball",
  "Surf",
  "Surf - Freediving",
  "Surf - Wake Surf",
  "Track & Field",
] as const;

/** Values like "Ian Walsh" or "nyjah_huston" must never be passed to access checks — resolve to UUID first. */
function looksLikeHumanAthleteIdPlaceholder(value: string): boolean {
  const v = String(value ?? "").trim();
  return v.length > 0 && /[\s_]/.test(v);
}

const DEFAULT_COMPANY_CATEGORY = "Uncategorized";

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Strip LIKE wildcards from user-supplied fragments for safe ilike patterns. */
function safeIlikeFragment(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/[%_,]/g, "");
}

async function resolveProfileUserIdsByAgentNameSearch(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  q: string
): Promise<string[]> {
  const frag = safeIlikeFragment(q);
  if (!frag) return [];
  const pattern = `%${frag}%`;
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
    .limit(60);
  if (error) throw error;
  return [...new Set((data ?? []).map((r: { user_id?: string }) => String(r.user_id ?? "")).filter(Boolean))];
}

async function getAthleteIdsForAgentUserIds(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  agentUserIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!agentUserIds.length) return out;
  for (const chunk of chunkArray(agentUserIds, 100)) {
    const [{ data: primaryRows }, { data: linkRows }] = await Promise.all([
      supabase.from("athletes").select("athlete_id").in("current_agent_id", chunk),
      supabase.from("athlete_agents").select("athlete_id").in("user_id", chunk),
    ]);
    for (const r of primaryRows ?? []) {
      const id = String((r as { athlete_id?: string }).athlete_id ?? "");
      if (id) out.add(id);
    }
    for (const r of linkRows ?? []) {
      const id = String((r as { athlete_id?: string }).athlete_id ?? "");
      if (id) out.add(id);
    }
  }
  return out;
}

type RosterAthleteRow = {
  athlete_id: string;
  first_name: string | null;
  last_name: string | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  current_agent_id: string | null;
};

async function fetchRosterAthletesWithFilters(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  idFilter: string[] | null,
  filters: { country: string; city: string; state: string; sport: string },
  limit: number
): Promise<RosterAthleteRow[]> {
  const selectCols =
    "athlete_id, first_name, last_name, sport, city, state, country, current_agent_id";

  const applyLocationSportFilters = (q: any) => {
    let x = q;
    if (filters.country) x = x.ilike("country", `%${filters.country}%`);
    if (filters.city) x = x.ilike("city", `%${filters.city}%`);
    if (filters.state) x = x.ilike("state", `%${filters.state}%`);
    if (filters.sport) x = x.ilike("sport", `%${filters.sport}%`);
    return x;
  };

  if (!idFilter || idFilter.length === 0) {
    let q = applyLocationSportFilters(supabase.from("athletes").select(selectCols));
    const { data, error } = await q.order("last_name", { ascending: true }).order("first_name", { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []) as RosterAthleteRow[];
  }

  if (idFilter.length <= 200) {
    let q = applyLocationSportFilters(supabase.from("athletes").select(selectCols).in("athlete_id", idFilter));
    const { data, error } = await q.order("last_name", { ascending: true }).order("first_name", { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []) as RosterAthleteRow[];
  }

  const merged: RosterAthleteRow[] = [];
  for (const chunk of chunkArray(idFilter, 200)) {
    let q = applyLocationSportFilters(supabase.from("athletes").select(selectCols).in("athlete_id", chunk));
    const { data, error } = await q.order("last_name", { ascending: true }).order("first_name", { ascending: true });
    if (error) throw error;
    merged.push(...((data ?? []) as RosterAthleteRow[]));
  }
  merged.sort((a, b) => {
    const ln = String(a.last_name ?? "").localeCompare(String(b.last_name ?? ""));
    if (ln !== 0) return ln;
    return String(a.first_name ?? "").localeCompare(String(b.first_name ?? ""));
  });
  const seen = new Set<string>();
  const unique: RosterAthleteRow[] = [];
  for (const r of merged) {
    if (seen.has(r.athlete_id)) continue;
    seen.add(r.athlete_id);
    unique.push(r);
  }
  return unique.slice(0, limit);
}

/** Display helper for Flow 7 roster audience counts (matches chat route spec). */
export function formatRosterAudienceCountDisplay(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

async function agentCanAccessAthlete(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile,
  athlete_id: string
): Promise<boolean> {
  if (profile.role === "admin" || profile.role === "sales") return true;
  if (profile.role !== "agent") return false;
  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", athlete_id)
    .single();
  if (athlete?.current_agent_id === profile.user_id) return true;
  const { data: links } = await supabase
    .from("athlete_agents")
    .select("user_id")
    .eq("athlete_id", athlete_id)
    .eq("user_id", profile.user_id)
    .limit(1);
  return Boolean(links && links.length > 0);
}

/** Athlete IDs an agent may access: primary assignment and athlete_agents links (must match agentCanAccessAthlete). */
async function getAgentAccessibleAthleteIds(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile
): Promise<string[]> {
  const [{ data: linked }, { data: primary }] = await Promise.all([
    supabase.from("athlete_agents").select("athlete_id").eq("user_id", profile.user_id),
    supabase.from("athletes").select("athlete_id").eq("current_agent_id", profile.user_id),
  ]);
  const ids = new Set<string>();
  for (const r of linked ?? []) {
    const id = (r as { athlete_id?: string })?.athlete_id;
    if (id) ids.add(String(id));
  }
  for (const r of primary ?? []) {
    const id = (r as { athlete_id?: string })?.athlete_id;
    if (id) ids.add(String(id));
  }
  return [...ids];
}

/** Athletes included in Flow 7 "general roster": whole company for admin/sales; agent assignments for agents. */
async function getRosterAthleteIdsForProfile(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile
): Promise<string[]> {
  if (profile.role === "admin" || profile.role === "sales") {
    const { data, error } = await supabase.from("athletes").select("athlete_id");
    if (error) throw error;
    return (data ?? []).map((r: { athlete_id?: string }) => String(r.athlete_id ?? "")).filter(Boolean);
  }
  if (profile.role === "agent") {
    return getAgentAccessibleAthleteIds(supabase, profile);
  }
  return [];
}

async function fetchDistinctInterestNamesOnRoster(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  rosterIds: string[]
): Promise<string[]> {
  if (!rosterIds.length) return [];
  const names = new Set<string>();
  for (const chunk of chunkArray(rosterIds, 200)) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select("audience_name")
      .eq("audience_category", "Interests")
      .in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const n = String((r as { audience_name?: string | null }).audience_name ?? "").trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

function resolveInterestNamesForRoster(interestInput: string[], distinctNamesOnRoster: string[]): string[] {
  const lowerToCanonical = new Map<string, string>();
  for (const n of distinctNamesOnRoster) {
    const t = String(n ?? "").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!lowerToCanonical.has(k)) lowerToCanonical.set(k, t);
  }
  for (const c of APPROVED_INTEREST_CATEGORIES) {
    const k = c.toLowerCase();
    if (!lowerToCanonical.has(k)) lowerToCanonical.set(k, c);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of interestInput) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const canon = lowerToCanonical.get(t.toLowerCase());
    if (canon && !seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

function effectiveIgInterestCount(
  igAudienceCount: number | null | undefined,
  igAudiencePercentRaw: number | null | undefined,
  igFollowersForEstimate: number
): number {
  const direct = Math.floor(Number(igAudienceCount ?? 0));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const pct = normalizeIgAudiencePercentToFraction(Number(igAudiencePercentRaw ?? 0));
  const ig = Math.max(0, Math.floor(Number(igFollowersForEstimate) || 0));
  if (pct > 0 && ig > 0) return Math.round(pct * ig);
  return 0;
}

async function rosterTotalFollowers(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  rosterIds: string[]
): Promise<number> {
  if (!rosterIds.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(rosterIds, 200)) {
    const { data, error } = await supabase.from("athlete_social_data").select("total_followers").in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      total += Number((r as { total_followers?: number | null }).total_followers ?? 0);
    }
  }
  return total;
}

async function fetchIgFollowersByAthleteId(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  athleteIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!athleteIds.length) return map;
  for (const chunk of chunkArray(athleteIds, 200)) {
    const { data, error } = await supabase
      .from("athlete_social_data")
      .select("athlete_id, ig_followers, total_followers")
      .in("athlete_id", chunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const id = String((r as { athlete_id?: string }).athlete_id ?? "");
      if (!id) continue;
      const ig = Number((r as { ig_followers?: number | null }).ig_followers ?? 0);
      const tot = Number((r as { total_followers?: number | null }).total_followers ?? 0);
      const base = ig > 0 ? ig : tot;
      map.set(id, Math.max(0, Math.floor(base)));
    }
  }
  return map;
}

export async function createAITools(profile: Profile) {
  const supabase = await createServerClient();

  const normalizeEmails = (emails: unknown): string[] => {
    if (!Array.isArray(emails)) return [];
    const set = new Set<string>();
    for (const raw of emails) {
      const email = String(raw ?? "").trim().toLowerCase();
      if (!email || !email.includes("@")) continue;
      set.add(email);
    }
    return [...set];
  };

  type AudienceCategory =
    | "Brands"
    | "Cities"
    | "Combined_Age"
    | "Countries"
    | "Ethnicity"
    | "Gender"
    | "Interests"
    | "States";

  const fetchAudienceByCategory = async (
    athlete_id: string,
    category: AudienceCategory,
    limit?: number
  ): Promise<Array<{ audience_name: string; ig_audience_percent: number; ig_audience_count: number }>> => {
    if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
      return [];
    }
    const effectiveLimit = Math.max(1, Math.min(limit ?? 10, 50));
    const { data } = await supabase
      .from("athlete_audience_data")
      .select("audience_name, ig_audience_percent, ig_audience_count")
      .eq("athlete_id", athlete_id)
      .eq("audience_category", category)
      .order("ig_audience_percent", { ascending: false })
      .limit(effectiveLimit);
    return (data ?? []).map((row: any) => ({
      audience_name: row.audience_name,
      ig_audience_percent: audiencePercentPoints(Number(row.ig_audience_percent ?? 0)),
      ig_audience_count: Number(row.ig_audience_count ?? 0),
    }));
  };

  const getOrCreateCompanyByName = async (nameInput: string): Promise<string> => {
    const name = String(nameInput ?? "").trim();
    if (!name) throw new Error("company name required");

    const { data: existing } = await supabase.from("companies").select("company_id").eq("name", name).maybeSingle();
    if (existing?.company_id) return existing.company_id;

    const { data: created, error: createError } = await supabase
      .from("companies")
      .insert({ name, industry: null })
      .select("company_id")
      .single();
    if (createError) throw createError;
    return created.company_id;
  };

  return {
    getDistinctAudienceInterests: async () => {
      /** Strict canonical IG "Interests" taxonomy only. Do not merge raw DB audience_name values — they often include legacy typos, sports roster strings, and non-taxonomy labels that pollute Flow 7 / email pickers. */
      const interests = [...APPROVED_INTEREST_CATEGORIES].sort((a, b) => a.localeCompare(b));
      return { interests };
    },

    getRosterAudienceSummary: async (params: { interest_names: string[] }) => {
      const interestInput = Array.isArray(params.interest_names)
        ? params.interest_names.map((s) => String(s ?? "").trim()).filter(Boolean)
        : [];

      const rosterIds = await getRosterAthleteIdsForProfile(supabase, profile);
      const roster_total_athletes = rosterIds.length;
      const roster_total_followers = await rosterTotalFollowers(supabase, rosterIds);

      const emptyBreakdown = [] as { interest_name: string; total_ig_audience_count: number; athlete_count: number }[];

      if (!interestInput.length) {
        return {
          roster_total_athletes,
          roster_total_followers,
          total_audience_count: 0,
          matched_athlete_count: 0,
          interest_breakdown: emptyBreakdown,
          total_audience_display: formatRosterAudienceCountDisplay(0),
          roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
        };
      }

      if (!rosterIds.length) {
        return {
          roster_total_athletes: 0,
          roster_total_followers: 0,
          total_audience_count: 0,
          matched_athlete_count: 0,
          interest_breakdown: emptyBreakdown,
          total_audience_display: formatRosterAudienceCountDisplay(0),
          roster_followers_display: formatRosterAudienceCountDisplay(0),
        };
      }

      const distinctOnRoster = await fetchDistinctInterestNamesOnRoster(supabase, rosterIds);
      const resolvedInterestNames = resolveInterestNamesForRoster(interestInput, distinctOnRoster);
      if (!resolvedInterestNames.length) {
        return {
          roster_total_athletes,
          roster_total_followers,
          total_audience_count: 0,
          matched_athlete_count: 0,
          interest_breakdown: emptyBreakdown,
          total_audience_display: formatRosterAudienceCountDisplay(0),
          roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
        };
      }

      const audienceRows: Array<{
        athlete_id: string;
        audience_name: string;
        ig_audience_count: number | null;
        ig_audience_percent: number | null;
      }> = [];

      for (const chunk of chunkArray(rosterIds, 200)) {
        const { data, error: audErr } = await supabase
          .from("athlete_audience_data")
          .select("athlete_id, audience_name, ig_audience_count, ig_audience_percent")
          .eq("audience_category", "Interests")
          .in("audience_name", resolvedInterestNames)
          .in("athlete_id", chunk);
        if (audErr) throw audErr;
        for (const row of data ?? []) {
          audienceRows.push(row as (typeof audienceRows)[number]);
        }
      }

      const athleteIdsNeedingFollowers = [...new Set(audienceRows.map((r) => String(r.athlete_id ?? "")).filter(Boolean))];
      const igFollowersByAthlete = await fetchIgFollowersByAthleteId(supabase, athleteIdsNeedingFollowers);

      let total_audience_count = 0;
      const matchedAthletes = new Set<string>();
      const sumByInterest = new Map<string, number>();
      const athletesByInterest = new Map<string, Set<string>>();

      for (const row of audienceRows) {
        const aid = String(row.athlete_id ?? "");
        const name = String(row.audience_name ?? "");
        if (!aid || !name) continue;
        const igBase = igFollowersByAthlete.get(aid) ?? 0;
        const cnt = effectiveIgInterestCount(row.ig_audience_count, row.ig_audience_percent, igBase);
        total_audience_count += cnt;
        matchedAthletes.add(aid);
        sumByInterest.set(name, (sumByInterest.get(name) ?? 0) + cnt);
        const set = athletesByInterest.get(name) ?? new Set<string>();
        set.add(aid);
        athletesByInterest.set(name, set);
      }

      const interest_breakdown = resolvedInterestNames.map((interest_name) => ({
        interest_name,
        total_ig_audience_count: sumByInterest.get(interest_name) ?? 0,
        athlete_count: athletesByInterest.get(interest_name)?.size ?? 0,
      }));
      interest_breakdown.sort((a, b) => b.total_ig_audience_count - a.total_ig_audience_count);

      return {
        roster_total_athletes,
        roster_total_followers,
        total_audience_count,
        matched_athlete_count: matchedAthletes.size,
        interest_breakdown,
        total_audience_display: formatRosterAudienceCountDisplay(total_audience_count),
        roster_followers_display: formatRosterAudienceCountDisplay(roster_total_followers),
      };
    },

    getCrmCompanyContext: async (params: { company_name: string }) => {
      const rawName = String(params.company_name ?? "").trim();
      if (!rawName) return { company_name: "", found: false as const };

      const { data: companyRows, error: companyErr } = await supabase
        .from("companies")
        .select("company_id, name")
        .ilike("name", `%${rawName}%`)
        .limit(10);
      if (companyErr) throw companyErr;
      const rows = Array.isArray(companyRows) ? companyRows : [];
      if (rows.length === 0) {
        return { company_name: rawName, found: false as const };
      }
      const exact = rows.find((r: any) => String(r?.name ?? "").trim().toLowerCase() === rawName.toLowerCase());
      const company = exact ?? rows[0];
      const company_id = String(company.company_id ?? "");
      const company_name = String(company.name ?? rawName);

      const { data: pipelineRows, error: pipeErr } = await supabase
        .from("crm_companies_pipeline")
        .select(
          "past_partnerships, idea_notes, pipeline_stage, instagram_handle, website_url, cmo_email, partnerships_email, experiential_email, support_email_v2, updated_at"
        )
        .eq("company_id", company_id)
        .eq("created_by_user_id", profile.user_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (pipeErr) throw pipeErr;
      const pipeline = Array.isArray(pipelineRows) && pipelineRows.length ? pipelineRows[0] : null;

      const strOrNull = (v: unknown): string | null => {
        if (v == null) return null;
        const s = String(v).trim();
        return s.length ? s : null;
      };

      return {
        found: true as const,
        company_id: company_id || null,
        company_name,
        past_partnerships: strOrNull(pipeline?.past_partnerships),
        idea_notes: strOrNull(pipeline?.idea_notes),
        pipeline_stage: strOrNull(pipeline?.pipeline_stage),
        instagram_handle: strOrNull(pipeline?.instagram_handle),
        website_url: strOrNull(pipeline?.website_url),
        cmo_email: strOrNull(pipeline?.cmo_email),
        partnerships_email: strOrNull(pipeline?.partnerships_email),
        experiential_email: strOrNull(pipeline?.experiential_email),
        support_email_v2: strOrNull(pipeline?.support_email_v2),
      };
    },

    findAthletesByAudienceInterestAndSport: async (params: {
      interest_names: string[];
      sports: string[];
    }) => {
      // ── STEP 1: Get all athlete IDs this user can access ──
      let accessibleAthleteIds: string[] = [];

      if (profile.role === "admin" || profile.role === "sales") {
        const { data: allAthletes } = await supabase.from("athletes").select("athlete_id");
        accessibleAthleteIds = (allAthletes ?? []).map((a: any) => a.athlete_id);
      } else {
        const { data: linked } = await supabase
          .from("athlete_agents")
          .select("athlete_id")
          .eq("user_id", profile.user_id);
        accessibleAthleteIds = (linked ?? []).map((r: any) => r.athlete_id);
      }

      if (accessibleAthleteIds.length === 0) return { sports: [] };

      // ── STEP 2: Filter accessible athletes by selected sports ──
      const selectedSports = (params.sports ?? [])
        .map((s: string) => String(s ?? "").trim())
        .filter(Boolean);

      const interestNames = (params.interest_names ?? [])
        .map((s: string) => String(s ?? "").trim())
        .filter(Boolean);

      if (selectedSports.length === 0 || interestNames.length === 0) {
        return { sports: [] };
      }

      const sportOrFilter = selectedSports.map((s: string) => `sport.ilike.%${s}%`).join(",");

      const { data: athletesInSports } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name, sport")
        .in("athlete_id", accessibleAthleteIds)
        .or(sportOrFilter);

      const athletesInSportsList = athletesInSports ?? [];
      if (athletesInSportsList.length === 0) return { sports: [] };

      const athletesInSportsIds = athletesInSportsList.map((a: any) => a.athlete_id);

      const athleteById = new Map(athletesInSportsList.map((a: any) => [a.athlete_id, a]));

      // ── STEP 3: Get audience rows for matching athletes ──
      const { data: audienceRows } = await supabase
        .from("athlete_audience_data")
        .select("athlete_id, audience_name, ig_audience_percent, ig_audience_count")
        .in("athlete_id", athletesInSportsIds)
        .eq("audience_category", "Interests")
        .in("audience_name", interestNames);

      const rows = audienceRows ?? [];
      if (rows.length === 0) return { sports: [] };

      // ── STEP 4: Sum ig_audience_count per athlete ──
      type AthleteScore = {
        athlete_id: string;
        total_ig_audience_count: number;
        interests: {
          audience_name: string;
          ig_audience_percent: number;
          ig_audience_count: number;
        }[];
      };

      const scoreMap = new Map<string, AthleteScore>();

      for (const row of rows) {
        const id = row.athlete_id as string;
        if (!scoreMap.has(id)) {
          scoreMap.set(id, {
            athlete_id: id,
            total_ig_audience_count: 0,
            interests: [],
          });
        }
        const entry = scoreMap.get(id)!;
        entry.total_ig_audience_count += Number(row.ig_audience_count ?? 0);
        entry.interests.push({
          audience_name: row.audience_name as string,
          ig_audience_percent: Number(row.ig_audience_percent ?? 0),
          ig_audience_count: Number(row.ig_audience_count ?? 0),
        });
      }

      // ── STEP 5: Group by actual sport value, top 5 per sport ──
      const sportGroupMap = new Map<string, AthleteScore[]>();

      for (const [athlete_id, score] of scoreMap.entries()) {
        const athlete = athleteById.get(athlete_id);
        if (!athlete) continue;
        const sport = athlete.sport as string;
        if (!sportGroupMap.has(sport)) sportGroupMap.set(sport, []);
        sportGroupMap.get(sport)!.push(score);
      }

      const result: {
        sport: string;
        athletes: {
          athlete_id: string;
          name: string;
          total_ig_audience_count: number;
          interests: {
            audience_name: string;
            ig_audience_percent: number;
            ig_audience_pct_display: string;
            ig_audience_count: number;
          }[];
        }[];
      }[] = [];

      const sortedSports = [...sportGroupMap.keys()].sort((a, b) => b.localeCompare(a));

      for (const sport of sortedSports) {
        const group = sportGroupMap.get(sport)!;

        group.sort((a, b) => b.total_ig_audience_count - a.total_ig_audience_count);

        const top5 = group.slice(0, 5);

        result.push({
          sport,
          athletes: top5.map((score) => {
            const athlete = athleteById.get(score.athlete_id)!;
            return {
              athlete_id: score.athlete_id,
              name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" "),
              total_ig_audience_count: score.total_ig_audience_count,
              interests: score.interests
                .sort((a, b) => b.ig_audience_percent - a.ig_audience_percent)
                .map((i) => ({
                  audience_name: i.audience_name,
                  ig_audience_percent: i.ig_audience_percent,
                  ig_audience_pct_display: `${(i.ig_audience_percent * 100).toFixed(1)}%`,
                  ig_audience_count: i.ig_audience_count,
                })),
            };
          }),
        });
      }

      return { sports: result };
    },

    searchAthletesByAudienceInterest: async (params: {
      interest_name: string;
      category?: "Brands" | "Interests";
      sport?: string;
      limit?: number;
    }) => {
      const interestName = String(params.interest_name ?? "").trim();
      if (!interestName) return [];

      const categories = params.category ? [params.category] : (["Brands", "Interests"] as const);
      const sourceLimit = 50;
      const outputLimit = Math.max(1, Math.min(params.limit ?? 15, 50));

      let query = supabase
        .from("athlete_audience_data")
        .select("athlete_id, audience_category, audience_name, ig_audience_percent")
        .ilike("audience_name", `%${interestName}%`)
        .in("audience_category", categories as any)
        .order("ig_audience_percent", { ascending: false })
        .limit(sourceLimit);

      const { data: audienceRows } = await query;
      const candidateRows: any[] = audienceRows ?? [];
      if (!candidateRows.length) return [];

      const athleteIds = [...new Set(candidateRows.map((r: any) => String(r.athlete_id ?? "")).filter(Boolean))];
      const [athleteRes, socialRes] = await Promise.all([
        supabase.from("athletes").select("athlete_id, first_name, last_name, sport").in("athlete_id", athleteIds),
        supabase.from("athlete_social_data").select("athlete_id, total_followers, ig_followers").in("athlete_id", athleteIds),
      ]);

      const athleteById = new Map((athleteRes.data ?? []).map((a: any) => [String(a.athlete_id), a]));
      const socialById = new Map((socialRes.data ?? []).map((s: any) => [String(s.athlete_id), s]));

      const rowsForRole: any[] = [];
      for (const row of candidateRows) {
        const athleteId = String(row.athlete_id ?? "");
        if (!athleteId) continue;
        if (!(await agentCanAccessAthlete(supabase, profile, athleteId))) continue;
        const athlete = athleteById.get(athleteId);
        if (params.sport?.trim() && !String(athlete?.sport ?? "").toLowerCase().includes(params.sport.trim().toLowerCase())) continue;
        rowsForRole.push(row);
      }

      return rowsForRole
        .map((row: any) => {
          const athleteId = String(row.athlete_id);
          const athlete = athleteById.get(athleteId);
          const social = socialById.get(athleteId);
          const raw = Number(row.ig_audience_percent ?? 0);
          return {
            athlete_id: athleteId,
            name: [athlete?.first_name, athlete?.last_name].filter(Boolean).join(" ").trim() || athleteId,
            sport: athlete?.sport ?? null,
            audience_name: row.audience_name,
            audience_category: row.audience_category,
            ig_audience_percent: audiencePercentPoints(raw),
            ig_audience_pct_display: fmtPct(raw),
            total_followers: social?.total_followers ?? null,
            ig_followers: social?.ig_followers ?? null,
            _sortPct: normalizeIgAudiencePercentToFraction(raw),
          };
        })
        .sort((a, b) => b._sortPct - a._sortPct)
        .map(({ _sortPct, ...rest }: any) => rest)
        .slice(0, outputLimit);
    },

    listAthletesScoped: async (params?: { sport?: string }) => {
      let query = supabase.from("athletes").select("athlete_id, first_name, last_name, sport, country, creatoriq_publisher_id");
      if (profile.role === "agent") {
        const ids = await getAgentAccessibleAthleteIds(supabase, profile);
        if (!ids.length) return [];
        query = query.in("athlete_id", ids);
      }
      if (params?.sport?.trim()) {
        query = query.ilike("sport", `%${params.sport.trim()}%`);
      }
      const { data } = await query.order("last_name");
      return data || [];
    },

    /**
     * Search roster athletes by roster location (city/state/country), sport, and/or representing agent.
     * Uses athletes table fields — not IG audience geo. Respects role scope (admin/sales: full roster; agents: assignments only).
     */
    searchRosterAthletes: async (params: {
      country?: string;
      city?: string;
      state?: string;
      sport?: string;
      agent_name?: string;
      limit?: number;
    }) => {
      const limit = Math.min(Math.max(Number(params.limit) || 150, 1), 400);
      const filters = {
        country: safeIlikeFragment(params.country ?? ""),
        city: safeIlikeFragment(params.city ?? ""),
        state: safeIlikeFragment(params.state ?? ""),
        sport: safeIlikeFragment(params.sport ?? ""),
      };
      const agentName = safeIlikeFragment(params.agent_name ?? "");

      const hasFilter = Boolean(
        filters.country || filters.city || filters.state || filters.sport || agentName
      );
      if (!hasFilter) {
        return {
          error:
            "Provide at least one filter: country, city, state, sport, or agent_name. For sport-only lists without other criteria, use listAthletesScoped.",
        };
      }

      let idFilter: string[] | null = null;

      if (profile.role === "agent") {
        const scoped = await getAgentAccessibleAthleteIds(supabase, profile);
        if (!scoped.length) {
          return { athletes: [] as const, total_returned: 0, truncated: false as const };
        }
        idFilter = scoped;
      }

      if (agentName) {
        const userIds = await resolveProfileUserIdsByAgentNameSearch(supabase, agentName);
        if (!userIds.length) {
          return {
            athletes: [] as const,
            total_returned: 0,
            truncated: false as const,
            note: `No agent profiles matched "${agentName}".`,
          };
        }
        const byAgent = await getAthleteIdsForAgentUserIds(supabase, userIds);
        const agentArr = [...byAgent];
        if (idFilter) {
          const allow = new Set(idFilter);
          idFilter = agentArr.filter((id) => allow.has(id));
        } else {
          idFilter = agentArr;
        }
        if (!idFilter.length) {
          return { athletes: [] as const, total_returned: 0, truncated: false as const };
        }
      }

      const rows = await fetchRosterAthletesWithFilters(supabase, idFilter, filters, limit);

      const agentIds = [...new Set(rows.map((r) => r.current_agent_id).filter(Boolean))] as string[];
      const profileById = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
      for (const chunk of chunkArray(agentIds, 100)) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, first_name, last_name, email")
          .in("user_id", chunk);
        for (const p of profs ?? []) {
          const row = p as {
            user_id: string;
            first_name: string | null;
            last_name: string | null;
            email: string | null;
          };
          profileById.set(String(row.user_id), row);
        }
      }

      return {
        total_returned: rows.length,
        truncated: rows.length >= limit,
        athletes: rows.map((r) => {
          const pr = r.current_agent_id ? profileById.get(r.current_agent_id) : undefined;
          const agentDisplay = pr
            ? [pr.first_name, pr.last_name].filter(Boolean).join(" ").trim() || null
            : null;
          return {
            athlete_id: r.athlete_id,
            name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim(),
            sport: r.sport,
            city: r.city,
            state: r.state,
            country: r.country,
            location_display: [r.city, r.state, r.country].filter(Boolean).join(", ") || null,
            primary_agent: r.current_agent_id
              ? {
                  user_id: r.current_agent_id,
                  name: agentDisplay,
                  email: pr?.email ?? null,
                }
              : null,
          };
        }),
      };
    },

    getAthlete: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      const { data } = await supabase
        .from("athletes")
        .select("*")
        .eq("athlete_id", athlete_id)
        .single();
      if (!data) return null;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      return data;
    },

    getAthleteAgents: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return [];
      }
      const { data } = await supabase
        .from("athlete_agents")
        .select(`
          user_id,
          is_primary,
          profiles:user_id (first_name, last_name, email)
        `)
        .eq("athlete_id", athlete_id)
        .order("is_primary", { ascending: false });
      if (!data) return [];
      return data.map((row: any) => ({
        user_id: row.user_id,
        is_primary: row.is_primary,
        first_name: row.profiles?.first_name,
        last_name: row.profiles?.last_name,
        email: row.profiles?.email,
        name: [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") || null,
      }));
    },

    getAthleteContracts: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return [];
      }
      const { data: contractsList } = await supabase
        .from("contracts")
        .select("*")
        .eq("athlete_id", athlete_id)
        .order("status", { ascending: false })
        .order("start_date", { ascending: false });
      if (!contractsList?.length) return [];

      const companyIds = [...new Set(contractsList.map((c: any) => c.company_id).filter(Boolean))];
      const contractIds = contractsList.map((c: any) => c.contract_id);
      const [companiesRes, exclusivitiesRes] = await Promise.all([
        companyIds.length > 0 ? supabase.from("companies").select("company_id, name").in("company_id", companyIds) : { data: [] },
        contractIds.length > 0
          ? supabase
              .from("contract_exclusivities")
              .select("contract_id, sponsorship_taxonomies:taxonomy_id(category)")
              .in("contract_id", contractIds)
          : { data: [] },
      ]);
      const companyMap = new Map((companiesRes?.data ?? []).map((c: any) => [c.company_id, c.name]));
      const categoriesByContract = new Map<string, string[]>();
      for (const e of exclusivitiesRes?.data ?? []) {
        const list = categoriesByContract.get((e as any).contract_id) ?? [];
        const cat = (e as any).sponsorship_taxonomies?.category;
        if (cat) list.push(cat);
        categoriesByContract.set((e as any).contract_id, list);
      }

      return contractsList.map((c: any) => ({
        ...c,
        companies: companyMap.get(c.company_id) ? { name: companyMap.get(c.company_id) } : null,
        category_labels: categoriesByContract.get(c.contract_id) ?? [],
      }));
    },

    getCompanyByName: async (params: { name: string }) => {
      const nameQ = String(params.name ?? "").trim();
      if (!nameQ) return null;

      // Use fuzzy match so minor punctuation/casing differences don't break lookup.
      const { data } = await supabase
        .from("companies")
        .select("*")
        .ilike("name", `%${nameQ}%`)
        .limit(10);

      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) return null;

      const exact = rows.find((r: any) => String(r?.name ?? "").trim().toLowerCase() === nameQ.toLowerCase());
      return exact ?? rows[0];
    },

    getCompanySponsorships: async (params: { company_id: string }) => {
      const { data } = await supabase
        .from("contracts")
        .select(`
          *,
          athletes (*)
        `)
        .eq("company_id", params.company_id)
        .eq("status", "active");
      return data || [];
    },

    getCompanyContacts: async (params: { company_id: string }) => {
      const { data } = await supabase
        .from("company_contacts")
        .select("*")
        .eq("company_id", params.company_id);
      return data || [];
    },

    pushCompanyToCrmPipeline: async (params: {
      company_name: string;
      category?: string;
      notes?: string;
      support_email?: string;
      contact_emails?: string[];
      /** Optional — when set, the athlete is merged into the card's potential_athletes so it shows up on the target list view. Accepts UUID or full name. */
      athlete_id?: string;
      athlete_name?: string;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };

      const company_id = await getOrCreateCompanyByName(company_name);
      const desiredCategory = String(params.category ?? "").trim() || DEFAULT_COMPANY_CATEGORY;
      const { data: companyRow, error: companyReadError } = await supabase
        .from("companies")
        .select("product_category")
        .eq("company_id", company_id)
        .maybeSingle();
      if (companyReadError) return { error: companyReadError.message };
      if (!String(companyRow?.product_category ?? "").trim()) {
        const { error: categoryErr } = await supabase
          .from("companies")
          .update({ product_category: desiredCategory })
          .eq("company_id", company_id);
        if (categoryErr) return { error: categoryErr.message };
      }
      const contact_emails = normalizeEmails(params.contact_emails);
      const support_email = String(params.support_email ?? "").trim().toLowerCase() || null;
      const notes = params.notes != null ? String(params.notes) : null;

      // Resolve optional athlete so the card appears on /athlete/:id/target-list. Accepts UUID or name.
      let athleteEntry: { athlete_id: string; name: string; sport: string | null } | null = null;
      const rawAthleteId = String(params.athlete_id ?? "").trim();
      const rawAthleteName = String(params.athlete_name ?? "").trim();
      if (rawAthleteId && !looksLikeHumanAthleteIdPlaceholder(rawAthleteId)) {
        const { data: aRow } = await supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .eq("athlete_id", rawAthleteId)
          .maybeSingle();
        if (aRow?.athlete_id && (await agentCanAccessAthlete(supabase, profile, aRow.athlete_id))) {
          athleteEntry = {
            athlete_id: String(aRow.athlete_id),
            name: [aRow.first_name, aRow.last_name].filter(Boolean).join(" ").trim(),
            sport: aRow.sport ?? null,
          };
        }
      }
      // If athlete_id was missing/invalid, fall back to athlete_name resolution.
      if (!athleteEntry && rawAthleteName) {
        const parts = rawAthleteName.split(/\s+/).filter(Boolean);
        const first = parts.length > 1 ? parts[0] : "";
        const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";
        let q = supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .limit(5);
        if (first) q = q.ilike("first_name", `%${first}%`);
        if (last) q = q.ilike("last_name", `%${last}%`);
        const { data } = await q;
        const candidates = Array.isArray(data) ? data : [];
        const exact = candidates.find((a: any) => {
          const full = [a.first_name, a.last_name].filter(Boolean).join(" ").trim().toLowerCase();
          return full === rawAthleteName.toLowerCase();
        });
        const picked = exact ?? candidates[0] ?? null;
        if (picked?.athlete_id && (await agentCanAccessAthlete(supabase, profile, picked.athlete_id))) {
          athleteEntry = {
            athlete_id: String(picked.athlete_id),
            name: [picked.first_name, picked.last_name].filter(Boolean).join(" ").trim(),
            sport: picked.sport ?? null,
          };
        }
      }

      const { data: existing } = await supabase
        .from("crm_companies_pipeline")
        .select("id, contact_emails, potential_athletes")
        .eq("company_id", company_id)
        .eq("created_by_user_id", profile.user_id)
        .maybeSingle();

      if (existing) {
        const mergedEmails = normalizeEmails([...(existing.contact_emails ?? []), ...contact_emails]);
        const existingAthletes = Array.isArray(existing.potential_athletes) ? [...existing.potential_athletes] : [];
        const alreadyLinked = athleteEntry
          ? existingAthletes.some((p: any) => String(p?.athlete_id ?? "") === athleteEntry!.athlete_id)
          : false;
        const nextAthletes = athleteEntry && !alreadyLinked ? [...existingAthletes, athleteEntry] : existingAthletes;
        const updatePatch: Record<string, unknown> = {
          support_email,
          notes,
          contact_emails: mergedEmails,
          status: "in_progress",
        };
        if (athleteEntry && !alreadyLinked) updatePatch.potential_athletes = nextAthletes;
        const { data: updated, error: updateError } = await supabase
          .from("crm_companies_pipeline")
          .update(updatePatch)
          .eq("id", existing.id)
          .select("id, company_id, status, support_email, contact_emails, notes, potential_athletes")
          .single();
        if (updateError) return { error: updateError.message };
        return {
          created: false,
          company_name,
          record: updated,
          athlete_linked: Boolean(athleteEntry && !alreadyLinked),
          athlete: athleteEntry ?? null,
        };
      }

      const { data: created, error: createError } = await supabase
        .from("crm_companies_pipeline")
        .insert({
          company_id,
          created_by_user_id: profile.user_id,
          status: "in_progress",
          support_email,
          notes,
          contact_emails,
          potential_athletes: athleteEntry ? [athleteEntry] : [],
        })
        .select("id, company_id, status, support_email, contact_emails, notes, potential_athletes")
        .single();
      if (createError) return { error: createError.message };
      return {
        created: true,
        company_name,
        record: created,
        athlete_linked: Boolean(athleteEntry),
        athlete: athleteEntry ?? null,
      };
    },

    pushEmailToCrm: async (params: {
      company_name: string;
      /** When set, saves to this CRM contact's email_drafts (must belong to company_name). Omit to save on the pipeline card only. */
      contact_id?: string;
      athlete_id?: string;
      email_subject: string;
      email_body: string;
      label?: string;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      const email_subject = String(params.email_subject ?? "").trim();
      const email_body = String(params.email_body ?? "");
      if (!company_name) return { ok: false as const, error: "company_name is required" };
      if (!email_subject) return { ok: false as const, error: "email_subject is required" };
      if (!email_body.trim()) return { ok: false as const, error: "email_body is required" };

      const rawAthleteParam = params.athlete_id?.trim() || null;
      const droppedNameLikeId = Boolean(rawAthleteParam && looksLikeHumanAthleteIdPlaceholder(rawAthleteParam));
      let athleteIdOpt =
        rawAthleteParam && !looksLikeHumanAthleteIdPlaceholder(rawAthleteParam) ? rawAthleteParam : null;
      if (athleteIdOpt && !(await agentCanAccessAthlete(supabase, profile, athleteIdOpt))) {
        return { ok: false as const, error: "Cannot access this athlete" };
      }

      const draftEntry = {
        label: (params.label?.trim() || email_subject) as string,
        subject: email_subject,
        body: email_body,
        athlete_id: athleteIdOpt,
        created_at: new Date().toISOString(),
      };

      const rawContactId = params.contact_id != null ? String(params.contact_id).trim() : "";

      /** Per-contact saves must use the contact row's company_id. String `company_name` resolution can hit a different companies row (duplicates, spelling), which previously caused false "contact does not belong to this company". */
      if (rawContactId) {
        const { data: contactRow, error: cErr } = await supabase
          .from("crm_contacts")
          .select("contact_id, company_id, first_name, last_name, email_drafts")
          .eq("contact_id", rawContactId)
          .maybeSingle();
        if (cErr) {
          const msg = cErr.message ?? "";
          const hint =
            /email_drafts|column|schema/i.test(msg)
              ? " Ensure the Supabase migration adding crm_contacts.email_drafts has been applied."
              : "";
          return { ok: false as const, error: `${msg}${hint}` };
        }
        if (!contactRow) {
          return { ok: false as const, error: "contact_id not found or not accessible (check CRM contact exists and RLS)" };
        }

        const contactCompanyId = String(contactRow.company_id ?? "");
        const { data: coRow, error: coRowErr } = await supabase
          .from("companies")
          .select("name")
          .eq("company_id", contactCompanyId)
          .maybeSingle();
        if (coRowErr) return { ok: false as const, error: coRowErr.message };
        const resolvedCompanyName = String(coRow?.name ?? company_name).trim() || company_name;

        const paramNorm = company_name.toLowerCase().replace(/\s+/g, " ").trim();
        const actualNorm = resolvedCompanyName.toLowerCase().replace(/\s+/g, " ").trim();
        const companyNameNote =
          paramNorm !== actualNorm
            ? `Draft saved on contact under company "${resolvedCompanyName}" (tool company_name was "${company_name}").`
            : undefined;

        const existingContactDrafts = Array.isArray(contactRow.email_drafts) ? [...contactRow.email_drafts] : [];
        const personLabel = [contactRow.first_name, contactRow.last_name].filter(Boolean).join(" ").trim();
        const contactDraftEntry = {
          ...draftEntry,
          label: (params.label?.trim() || personLabel || draftEntry.label) as string,
        };
        const { data: updatedRows, error: upCErr } = await supabase
          .from("crm_contacts")
          .update({ email_drafts: [...existingContactDrafts, contactDraftEntry] })
          .eq("contact_id", rawContactId)
          .select("contact_id");
        if (upCErr) {
          const msg = upCErr.message ?? "";
          const hint =
            /email_drafts|column|schema/i.test(msg)
              ? " Apply migration 20260408120000_crm_contacts_email_drafts.sql (or equivalent) so email_drafts exists."
              : "";
          const perm =
            /permission denied|RLS|row-level security|42501/i.test(msg)
              ? " If you use a sales login, apply migration 20260409120000_crm_contacts_sales_can_update.sql so sales can update contacts."
              : "";
          return { ok: false as const, error: `${msg}${hint}${perm}` };
        }
        if (!updatedRows?.length) {
          return {
            ok: false as const,
            error:
              "CRM contact update affected 0 rows (RLS or missing row). Agents may only edit their own contacts. Sales accounts need DB policy allowing updates to crm_contacts — apply migration 20260409120000_crm_contacts_sales_can_update.sql.",
          };
        }

        const droppedNote = droppedNameLikeId
          ? "athlete_id looked like a person name (not a DB id) and was omitted; draft saved. Pass resolveAthletesByName → UUID to link."
          : undefined;
        const note = [companyNameNote, droppedNote].filter(Boolean).join(" ") || undefined;

        return {
          ok: true as const,
          company_name: resolvedCompanyName,
          company_id: contactCompanyId,
          contact_id: rawContactId,
          saved_to: "crm_contact" as const,
          created: false as const,
          athlete_id_saved: athleteIdOpt,
          ...(note ? { note } : {}),
        };
      }

      let companyCreated = false;
      const { data: companyRows, error: coErr } = await supabase
        .from("companies")
        .select("company_id, name")
        .ilike("name", company_name)
        .limit(20);
      if (coErr) return { ok: false as const, error: coErr.message };
      const cRows = companyRows ?? [];
      const exactCo = cRows.find((r: any) => String(r?.name ?? "").trim().toLowerCase() === company_name.toLowerCase());
      const pickedCo = exactCo ?? cRows[0];

      let company_id: string;
      if (!pickedCo?.company_id) {
        const { data: inserted, error: insErr } = await supabase
          .from("companies")
          .insert({ name: company_name, industry: null })
          .select("company_id")
          .single();
        if (insErr) return { ok: false as const, error: insErr.message };
        company_id = inserted.company_id;
        companyCreated = true;
      } else {
        company_id = String(pickedCo.company_id);
      }

      const { data: pipeRows, error: pipeSelErr } = await supabase
        .from("crm_companies_pipeline")
        .select("id, pipeline_stage, draft_messages")
        .eq("company_id", company_id)
        .eq("created_by_user_id", profile.user_id)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (pipeSelErr) return { ok: false as const, error: pipeSelErr.message };

      const existingPipe = pipeRows && pipeRows.length ? (pipeRows[0] as any) : null;
      const existingDrafts = Array.isArray(existingPipe?.draft_messages) ? [...existingPipe.draft_messages] : [];

      let pipelineCreated = false;

      if (!existingPipe?.id) {
        const { data: newPipe, error: createPipeErr } = await supabase
          .from("crm_companies_pipeline")
          .insert({
            company_id,
            created_by_user_id: profile.user_id,
            status: "in_progress",
            pipeline_stage: "drafting",
            draft_messages: [draftEntry],
          })
          .select("id, pipeline_stage")
          .single();
        if (createPipeErr) return { ok: false as const, error: createPipeErr.message };
        pipelineCreated = true;
        return {
          ok: true as const,
          company_name,
          company_id,
          pipeline_id: String(newPipe.id),
          pipeline_stage: String(newPipe.pipeline_stage),
          created: companyCreated || pipelineCreated,
          athlete_id_saved: athleteIdOpt,
          ...(droppedNameLikeId
            ? {
                note: "athlete_id looked like a person name (not a DB id) and was omitted; draft saved. Pass resolveAthletesByName → UUID to link.",
              }
            : {}),
        };
      }

      const pipeline_id = String(existingPipe.id);
      const prevStage = String(existingPipe.pipeline_stage ?? "target");
      const nextStage =
        prevStage === "target" || prevStage === "research" ? "drafting" : prevStage;

      const updatedDrafts = [...existingDrafts, draftEntry];

      const { error: updErr } = await supabase
        .from("crm_companies_pipeline")
        .update({
          draft_messages: updatedDrafts,
          pipeline_stage: nextStage,
        })
        .eq("id", pipeline_id);

      if (updErr) return { ok: false as const, error: updErr.message };

      return {
        ok: true as const,
        company_name,
        company_id,
        pipeline_id,
        pipeline_stage: nextStage,
        created: companyCreated || pipelineCreated,
        athlete_id_saved: athleteIdOpt,
        ...(droppedNameLikeId
          ? {
              note: "athlete_id looked like a person name (not a DB id) and was omitted; draft saved. Pass resolveAthletesByName → UUID to link.",
            }
          : {}),
      };
    },

    getAthleteSocialStats: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      const { data } = await supabase.from("athlete_social_data").select("*").eq("athlete_id", athlete_id).maybeSingle();
      return data ?? null;
    },

    getAthleteAudienceByCategory: async (params: {
      athlete_id: string;
      category: "Brands" | "Cities" | "Combined_Age" | "Countries" | "Ethnicity" | "Gender" | "Interests" | "States";
      limit?: number;
    }) => {
      return fetchAudienceByCategory(params.athlete_id, params.category, params.limit);
    },

    getAudienceGender: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Gender", params.limit);
    },

    getAudienceAge: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Combined_Age", params.limit);
    },

    getAudienceEthnicity: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Ethnicity", params.limit);
    },

    getAudienceCountries: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Countries", params.limit);
    },

    getAudienceBrands: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Brands", params.limit);
    },

    getAudienceInterests: async (params: { athlete_id: string; limit?: number }) => {
      return fetchAudienceByCategory(params.athlete_id, "Interests", params.limit);
    },

    getAthleteFullAudienceProfile: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      const profileData = await getAthleteAudienceProfile(supabase, athlete_id);
      const pct2 = (n: number | null | undefined) => (n == null ? null : Number((n * 100).toFixed(2)));
      const mapRows = (rows: any[], limit?: number) =>
        (limit ? rows.slice(0, limit) : rows).map((r: any) => ({
          name: r.audience_name,
          ig_audience_percent: audiencePercentPoints(Number(r.ig_audience_percent ?? 0)),
          pct_display: fmtPct(Number(r.ig_audience_percent ?? 0)),
          ig_audience_count: Number(r.ig_audience_count ?? 0),
        }));

      return {
        social: profileData.social
          ? {
              total_followers: profileData.social.total_followers,
              ig_followers: profileData.social.ig_followers,
              tt_followers: profileData.social.tt_followers,
              fb_followers: profileData.social.fb_followers,
              x_followers: profileData.social.x_followers,
              avg_er_20p: pct2(profileData.social.avg_er_20p),
              ig_er: pct2(profileData.social.avg_er_ig_20p),
              tt_er: pct2(profileData.social.avg_er_tt_20p),
            }
          : null,
        top_interests: mapRows(profileData.interests, 5),
        top_brands: mapRows(profileData.brands, 5),
        gender: mapRows(profileData.gender),
        age: mapRows(profileData.age),
        top_countries: mapRows(profileData.countries, 5),
        top_states: mapRows(profileData.states, 5),
      };
    },

    searchAthletesByInterestKeywordsWithFollowing: async (params: {
      interest_keywords: string[];
      topPerKeyword?: number;
    }) => {
      const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
      const canonicalizeKeyword = (keyword: string): string | null => {
        const canonical = canonicalInterestByNormalized[normalizeLabel(keyword)];
        return canonical ?? null;
      };

      // Only use approved (canonical) interest keywords; ignore anything else.
      // This prevents the model from accidentally searching/mirroring non-approved labels.
      const inputKeywords = Array.isArray(params.interest_keywords) ? params.interest_keywords : [];
      const keywords: string[] = [];
      const seen = new Set<string>();
      const pushKeyword = (k: string) => {
        const kk = k.trim();
        if (!kk) return;
        const key = kk.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        keywords.push(kk);
      };

      for (const k of inputKeywords) {
        const canonical = canonicalizeKeyword(String(k ?? ""));
        if (!canonical) continue;
        // Deterministic related interests expansion.
        if (canonical === "Healthy Lifestyle") {
          pushKeyword("Healthy Lifestyle");
          pushKeyword("Fitness & Yoga");
          pushKeyword("Sports");
          pushKeyword("Activewear");
        } else {
          pushKeyword(canonical);
        }
      }

      const topPerKeyword = Math.max(1, Math.min(params.topPerKeyword ?? 5, 25));
      if (keywords.length === 0) return { searched_interests: [], results: [] as any[] };

      // For each keyword, query all matching interest rows and pick best per athlete (max percent).
      const allResults: any[] = [];

      for (const keyword of keywords) {
        const { data } = await supabase
          .from("athlete_audience_data")
          .select("athlete_id,audience_name,ig_audience_percent,ig_audience_count")
          .eq("audience_category", "Interests")
          .ilike("audience_name", `%${keyword}%`)
          .order("ig_audience_percent", { ascending: false })
          .limit(5000);

        const rows: any[] = data ?? [];

        const bestByAthlete = new Map<string, any>();
        for (const r of rows) {
          const athlete_id = r.athlete_id as string;
          const audienceCanonical = canonicalInterestByNormalized[normalizeLabel(String(r.audience_name ?? ""))];
          if (!audienceCanonical) continue; // exclude non-approved interest labels

          const pct =
            r.ig_audience_percent == null ? null : normalizeIgAudiencePercentToFraction(Number(r.ig_audience_percent));
          if (pct == null || Number.isNaN(pct)) continue;

          const current = bestByAthlete.get(athlete_id);
          const currentPct =
            current?.ig_audience_percent == null
              ? null
              : normalizeIgAudiencePercentToFraction(Number(current.ig_audience_percent));
          if (!current || pct > (currentPct ?? -Infinity)) {
            bestByAthlete.set(athlete_id, { ...r, audience_name: audienceCanonical });
          }
        }

        const candidateAthleteIds = Array.from(bestByAthlete.keys());

        // Access filtering (agents only).
        const accessibleAthleteIds: string[] = [];
        for (const athlete_id of candidateAthleteIds) {
          if (await agentCanAccessAthlete(supabase, profile, athlete_id)) accessibleAthleteIds.push(athlete_id);
        }

        if (accessibleAthleteIds.length === 0) continue;

        const { data: athleteRows } = await supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .in("athlete_id", accessibleAthleteIds);

        const { data: socialRows } = await supabase
          .from("athlete_social_data")
          .select("athlete_id,total_followers,ig_followers,tt_followers,fb_followers,x_followers")
          .in("athlete_id", accessibleAthleteIds);

        const athleteById = new Map<string, any>(Array.isArray(athleteRows) ? athleteRows.map((a: any) => [a.athlete_id, a]) : []);
        const socialById = new Map<string, any>(Array.isArray(socialRows) ? socialRows.map((s: any) => [s.athlete_id, s]) : []);

        const assembled: any[] = [];
        for (const athlete_id of accessibleAthleteIds) {
          const best = bestByAthlete.get(athlete_id);
          if (!best) continue;

          const athlete = athleteById.get(athlete_id);
          const social = socialById.get(athlete_id);

          const total_followers =
            social?.total_followers ??
            (social ? (social.ig_followers ?? 0) + (social.tt_followers ?? 0) + (social.fb_followers ?? 0) + (social.x_followers ?? 0) : null);

          if (total_followers == null) {
            // Still allow ranking; keep null following.
          }

          assembled.push({
            athlete_id,
            athlete_name: athlete
              ? [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || athlete_id
              : athlete_id,
            sport: athlete?.sport ?? null,
            searched_interest_keyword: keyword,
            interest_name: best.audience_name ?? null,
            interest_pct:
              best.ig_audience_percent == null ? null : audiencePercentPoints(Number(best.ig_audience_percent)),
            interest_count: best.ig_audience_count ?? null,
            following_total: total_followers ?? null,
          });
        }

        assembled.sort((a, b) => Number(b.interest_pct ?? -Infinity) - Number(a.interest_pct ?? -Infinity));
        allResults.push(...assembled.slice(0, topPerKeyword).map((r) => ({ ...r, rank_for_keyword: null })));
      }

      // assign rank per keyword (stable)
      const grouped: Record<string, any[]> = {};
      for (const r of allResults) {
        const k = String(r.searched_interest_keyword ?? "");
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(r);
      }
      for (const k of Object.keys(grouped)) {
        grouped[k].sort((a, b) => Number(b.interest_pct ?? -Infinity) - Number(a.interest_pct ?? -Infinity));
        grouped[k] = grouped[k].map((r, i) => ({ ...r, rank_for_keyword: i + 1 }));
      }

      const results = Object.values(grouped).flat();
      return { searched_interests: keywords, results };
    },

    /**
     * Sport-aware version of interest search.
     * Returns top N athletes per sport per interest keyword, including separate interest percentages and follower totals.
     *
     * Also expands certain interest keywords to include "related" approved interests deterministically.
     * Example: "Healthy Lifestyle" expands to include Fitness & Yoga, Sports, Activewear.
     */
    searchAthletesBySportsAndInterestKeywordsWithFollowing: async (params: {
      sports: string[];
      interest_keywords: string[];
      topPerSportPerInterest?: number;
    }) => {
      const sportsInput = Array.isArray(params.sports) ? params.sports.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
      const inputKeywords = Array.isArray(params.interest_keywords)
        ? params.interest_keywords.map((k) => String(k ?? "").trim()).filter(Boolean)
        : [];

      const topPerSportPerInterest = Math.max(1, Math.min(params.topPerSportPerInterest ?? 5, 25));
      if (sportsInput.length === 0 || inputKeywords.length === 0) {
        return { searched_interests: [], results: [] as any[] };
      }

      function normalizeLabel(label: string) {
        return label.trim().replace(/\s+/g, " ").toLowerCase();
      }

      function normalizeSportQuery(s: string) {
        const t = s.toLowerCase();
        if (t.includes("surf")) return "surf";
        if (t.includes("skate")) return "skate";
        if (t.includes("snow")) return "snow";
        return t;
      }

      function expandKeywords(keywords: string[]): string[] {
        const expanded: string[] = [];
        const seen = new Set<string>();
        const push = (k: string) => {
          const kk = k.trim();
          if (!kk) return;
          const key = kk.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          expanded.push(kk);
        };

        for (const k of keywords) {
          const canonical = canonicalInterestByNormalized[normalizeLabel(k)];
          if (canonical) {
            push(canonical);
            if (canonical === "Healthy Lifestyle") {
              push("Fitness & Yoga");
              push("Sports");
              push("Activewear");
            }
          }
        }
        return expanded;
      }

      const expandedKeywords = expandKeywords(inputKeywords);

      const allResults: any[] = [];

      // Pre-fetch social metrics for all athletes across sports? Simpler: fetch per sport id set.
      for (const sportRaw of sportsInput) {
        const sportQuery = normalizeSportQuery(sportRaw);

        let athleteQuery = supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .limit(4000);

        if (profile.role === "agent") {
          athleteQuery = athleteQuery.eq("current_agent_id", profile.user_id);
        }
        if (sportQuery) {
          athleteQuery = athleteQuery.ilike("sport", `%${sportQuery}%`);
        }

        const { data: candidateAthletes } = await athleteQuery;
        const candidateIds: string[] = Array.isArray(candidateAthletes)
          ? candidateAthletes.map((a: any) => a.athlete_id).filter(Boolean)
          : [];

        // Correctness filter for agents (handles athlete_agents access).
        const accessibleIds: string[] = [];
        for (const athlete_id of candidateIds) {
          if (await agentCanAccessAthlete(supabase, profile, athlete_id)) accessibleIds.push(athlete_id);
        }
        if (accessibleIds.length === 0) continue;

        const { data: socialRows } = await supabase
          .from("athlete_social_data")
          .select("athlete_id, total_followers, ig_followers, tt_followers, fb_followers, x_followers")
          .in("athlete_id", accessibleIds);
        const socialById = new Map<string, any>(Array.isArray(socialRows) ? socialRows.map((s: any) => [s.athlete_id, s]) : []);

        const athleteById = new Map<string, any>(Array.isArray(candidateAthletes) ? candidateAthletes.map((a: any) => [a.athlete_id, a]) : []);

        for (const keyword of expandedKeywords) {
          const { data: interestRows } = await supabase
            .from("athlete_audience_data")
            .select("athlete_id, audience_name, ig_audience_percent, ig_audience_count")
            .eq("audience_category", "Interests")
            .in("athlete_id", accessibleIds)
            .ilike("audience_name", `%${keyword}%`)
            .order("ig_audience_percent", { ascending: false })
            .limit(8000);

          const rows: any[] = interestRows ?? [];
          const bestByAthlete = new Map<string, any>();
          for (const r of rows) {
            const id = r.athlete_id as string;
            const audienceCanonical = canonicalInterestByNormalized[normalizeLabel(String(r.audience_name ?? ""))];
            if (!audienceCanonical) continue; // exclude non-approved interest labels
            const pct =
              r.ig_audience_percent == null ? null : normalizeIgAudiencePercentToFraction(Number(r.ig_audience_percent));
            if (pct == null || Number.isNaN(pct)) continue;
            const current = bestByAthlete.get(id);
            const currentPct =
              current?.ig_audience_percent == null
                ? null
                : normalizeIgAudiencePercentToFraction(Number(current.ig_audience_percent));
            if (!current || pct > (currentPct ?? -Infinity)) {
              bestByAthlete.set(id, { ...r, audience_name: audienceCanonical });
            }
          }

          const assembled: any[] = [];
          for (const [athlete_id, best] of bestByAthlete.entries()) {
            const athlete = athleteById.get(athlete_id);
            const social = socialById.get(athlete_id);
            const total_followers =
              social?.total_followers ??
              (social ? (social.ig_followers ?? 0) + (social.tt_followers ?? 0) + (social.fb_followers ?? 0) + (social.x_followers ?? 0) : null);

            if (total_followers == null) continue; // keep output clean; followers are part of user requirement

            assembled.push({
              sport: athlete?.sport ?? null,
              athlete_id,
              athlete_name: athlete ? [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || athlete_id : athlete_id,
              searched_interest_keyword: keyword,
              interest_name: best.audience_name ?? null,
              interest_pct:
                best.ig_audience_percent == null ? null : audiencePercentPoints(Number(best.ig_audience_percent)),
              interest_count: best.ig_audience_count ?? null,
              following_total: total_followers,
            });
          }

          assembled.sort((a, b) => Number(b.interest_pct ?? -Infinity) - Number(a.interest_pct ?? -Infinity));
          const top = assembled.slice(0, topPerSportPerInterest);
          top.forEach((r, idx) => {
            allResults.push({
              ...r,
              rank_for_sport_interest: idx + 1,
              sport_query: sportRaw,
            });
          });
        }
      }

      return { searched_interests: expandedKeywords, results: allResults };
    },

    getSponsorshipTargets: async (params: {
      athlete_id: string;
      category_hint?: string;
      limit?: number;
    }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) return null;

      const limit = Math.max(1, Math.min(params.limit ?? 20, 50));

      // 1. Get athlete basic info
      const { data: athlete } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name, sport, accolades")
        .eq("athlete_id", athlete_id)
        .single();
      if (!athlete) return null;

      // 2. Get athlete's covered categories (DO NOT suggest companies in these)
      const { data: coveredRaw } = await supabase
        .from("athlete_covered_categories")
        .select("sponsorship_taxonomies:taxonomy_id(category)")
        .eq("athlete_id", athlete_id);
      const coveredCategories: string[] = (coveredRaw ?? [])
        .map((r: any) => r.sponsorship_taxonomies?.category)
        .filter(Boolean);

      // 3. Get athlete's existing contracts (DO NOT suggest companies already contracted)
      const { data: contractsRaw } = await supabase
        .from("contracts")
        .select("company_id, category")
        .eq("athlete_id", athlete_id)
        .eq("archived", false)
        .in("status", ["active"]);

      const existingCompanyIds = new Set((contractsRaw ?? []).map((c: any) => c.company_id).filter(Boolean));
      const existingCategories: string[] = [...new Set((contractsRaw ?? []).map((c: any) => c.category).filter(Boolean))];

      // 4. Get top brand affinities from athlete's audience
      //    These are brands the athlete's audience already follows/knows
      const { data: brandRows } = await supabase
        .from("athlete_audience_data")
        .select("audience_name, ig_audience_percent, ig_audience_count")
        .eq("athlete_id", athlete_id)
        .eq("audience_category", "Brands")
        .order("ig_audience_percent", { ascending: false })
        .limit(50);

      // 5. Get top interests from athlete's audience
      const { data: interestRows } = await supabase
        .from("athlete_audience_data")
        .select("audience_name, ig_audience_percent, ig_audience_count")
        .eq("athlete_id", athlete_id)
        .eq("audience_category", "Interests")
        .order("ig_audience_percent", { ascending: false })
        .limit(20);

      // 6. Get taxonomy for athlete's sport to identify open categories
      const { endemic, nonEndemic } = await getTaxonomyBySport(athlete.sport ?? null);
      const allTaxonomyCategories = [...endemic, ...nonEndemic];
      const blockedCategories = new Set([
        ...coveredCategories.map((c: string) => c.toLowerCase()),
        ...existingCategories.map((c: string) => c.toLowerCase()),
      ]);
      const openCategories = allTaxonomyCategories.filter((c) => !blockedCategories.has(c.toLowerCase()));

      // 7. Build brand targets from audience brand affinity data
      //    Filter out brands that are already sponsors
      const brandTargets = (brandRows ?? [])
        .filter((r: any) => {
          // Skip if category_hint provided and brand doesn't seem relevant
          if (params.category_hint) {
            // Keep all — let the AI filter by relevance using category_hint context
          }
          return true;
        })
        .map((r: any) => ({
          company_name: r.audience_name,
          source: "audience_brand_affinity" as const,
          ig_audience_percent: Number(r.ig_audience_percent ?? 0),
          ig_audience_pct_display: `${(Number(r.ig_audience_percent ?? 0) * 100).toFixed(1)}%`,
          ig_audience_count: Number(r.ig_audience_count ?? 0),
          rationale: `${(Number(r.ig_audience_percent ?? 0) * 100).toFixed(1)}% of ${athlete.first_name}'s audience already follows this brand`,
        }));

      // 8. Also look up companies in the DB that match open categories
      //    (companies already in the system we've worked with)
      const { data: knownCompanies } = await supabase.from("companies").select("company_id, name, industry").limit(200);

      const existingContractCompanyIds = existingCompanyIds;
      const knownTargets = (knownCompanies ?? [])
        .filter((c: any) => !existingContractCompanyIds.has(c.company_id))
        .map((c: any) => ({
          company_name: c.name,
          company_id: c.company_id,
          industry: c.industry,
          source: "known_company" as const,
          ig_audience_percent: null,
          ig_audience_pct_display: null,
          ig_audience_count: null,
          rationale: `Known company in system${c.industry ? ` (${c.industry})` : ""}`,
        }));

      return {
        athlete: {
          athlete_id,
          name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" "),
          sport: athlete.sport,
          accolades: athlete.accolades ?? [],
        },
        context: {
          existing_sponsor_categories: existingCategories,
          covered_categories: coveredCategories,
          open_taxonomy_categories: openCategories,
          category_hint: params.category_hint ?? null,
        },
        audience_brand_targets: brandTargets.slice(0, limit),
        top_interests: (interestRows ?? []).slice(0, 10).map((r: any) => ({
          interest: r.audience_name,
          pct_display: `${(Number(r.ig_audience_percent ?? 0) * 100).toFixed(1)}%`,
          ig_audience_percent: Number(r.ig_audience_percent ?? 0),
        })),
        known_company_targets: knownTargets.slice(0, 20),
        open_categories: openCategories,
      };
    },

    getAthleteCoveredCategories: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) return { category_names: [] };
      const { data } = await supabase
        .from("athlete_covered_categories")
        .select("sponsorship_taxonomies:taxonomy_id(category)")
        .eq("athlete_id", athlete_id);
      const category_names = (data || [])
        .map((r: any) => r.sponsorship_taxonomies?.category)
        .filter(Boolean);
      return { category_names };
    },

    /** Taxonomy categories for a sport (endemic + non-endemic). Resolves roster sport aliases. Use to determine missing sponsor categories when prospecting. */
    getTaxonomyForSport: async (params: { sport: string }) => {
      const { endemic, nonEndemic } = await getTaxonomyBySport(params.sport?.trim() || null);
      return { endemic, nonEndemic };
    },

    /**
     * Resolve athlete candidates from a free-form name string.
     * Useful when the user references a previous list by name ("their interest%, following...").
     */
    resolveAthletesByName: async (params: { names: string[]; limitPerName?: number }) => {
      const limitPerName = Math.max(1, Math.min(params.limitPerName ?? 5, 10));
      const uniqueNames = (params.names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);

      const resolveOne = async (name: string) => {
        const parts = name.split(/\s+/).filter(Boolean);
        const first = parts.length > 1 ? parts[0] : "";
        const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";

        const fetchLimit =
          profile.role === "agent" ? Math.max(limitPerName * 10, 50) : limitPerName;
        let query = supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport, country")
          .limit(fetchLimit);
        // Do not filter agents by current_agent_id only — many athletes are linked via athlete_agents.
        if (profile.role === "agent") {
          const rosterIds = await getAgentAccessibleAthleteIds(supabase, profile);
          if (!rosterIds.length) return { query: name, matches: [] as any[] };
          if (rosterIds.length <= 400) {
            query = query.in("athlete_id", rosterIds);
          }
        }

        if (first) query = query.ilike("first_name", `%${first}%`);
        if (last) query = query.ilike("last_name", `%${last}%`);

        const { data } = await query.order("last_name");
        const candidates = (data ?? []).map((a: any) => {
          const full = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
          const fullLower = full.toLowerCase();
          const nameLower = name.toLowerCase();
          const exact = fullLower === nameLower;
          const firstMatch = first ? a.first_name?.toLowerCase?.() === first.toLowerCase() : false;
          const lastMatch = last ? a.last_name?.toLowerCase?.() === last.toLowerCase() : false;
          const confidence = exact ? 1 : (firstMatch ? 0.7 : 0) + (lastMatch ? 0.7 : 0);
          return { athlete_id: a.athlete_id, first_name: a.first_name, last_name: a.last_name, sport: a.sport, country: a.country, confidence };
        });

        // Correctness filter for agents (handles cases where the athlete is linked via athlete_agents).
        const accessible = [];
        for (const c of candidates) {
          if (await agentCanAccessAthlete(supabase, profile, c.athlete_id)) accessible.push(c);
        }

        accessible.sort((a: any, b: any) => Number(b.confidence) - Number(a.confidence));
        return { query: name, matches: accessible.slice(0, limitPerName) };
      };

      return Promise.all(uniqueNames.map(resolveOne));
    },

    /**
     * Return IG audience interest metrics for a list of athletes for a given interest keyword.
     * interest_pct => ig_audience_percent
     * interest_count => ig_audience_count
     */
    getAthletesAudienceInterestMetrics: async (params: { athlete_ids: string[]; interest_query: string }) => {
      const athleteIds = (params.athlete_ids ?? []).filter(Boolean);
      const interest_query = (params.interest_query ?? "").trim();
      if (!athleteIds.length || !interest_query) return [];

      const accessibleIds: string[] = [];
      for (const athlete_id of athleteIds) {
        if (await agentCanAccessAthlete(supabase, profile, athlete_id)) accessibleIds.push(athlete_id);
      }
      if (!accessibleIds.length) return [];

      const { data } = await supabase
        .from("athlete_audience_data")
        .select("athlete_id, audience_name, ig_audience_percent, ig_audience_count")
        .in("athlete_id", accessibleIds)
        .eq("audience_category", "Interests")
        .ilike("audience_name", `%${interest_query}%`);

      const rows: any[] = data ?? [];

      // Choose the best-matching row per athlete by highest ig_audience_percent.
      const bestByAthlete = new Map<string, any>();
      for (const r of rows) {
        const id = r.athlete_id as string;
        const pct =
          r.ig_audience_percent == null ? -Infinity : normalizeIgAudiencePercentToFraction(Number(r.ig_audience_percent));
        const current = bestByAthlete.get(id);
        const currentPct =
          current?.ig_audience_percent == null
            ? -Infinity
            : normalizeIgAudiencePercentToFraction(Number(current.ig_audience_percent));
        if (!current || pct > currentPct) {
          bestByAthlete.set(id, r);
        }
      }

      return athleteIds.map((athlete_id) => {
        const r = bestByAthlete.get(athlete_id);
        return {
          athlete_id,
          interest_name: r?.audience_name ?? null,
          interest_pct:
            r?.ig_audience_percent == null ? null : audiencePercentPoints(Number(r.ig_audience_percent)),
          interest_count: r?.ig_audience_count ?? null,
        };
      });
    },

    /**
     * Return overall follower counts for a list of athletes.
     * following_total => total_followers (fallback to sum of per-platform followers if total_followers is null).
     */
    getAthletesSocialFollowing: async (params: { athlete_ids: string[] }) => {
      const athleteIds = (params.athlete_ids ?? []).filter(Boolean);
      if (!athleteIds.length) return [];

      const accessibleIds: string[] = [];
      for (const athlete_id of athleteIds) {
        if (await agentCanAccessAthlete(supabase, profile, athlete_id)) accessibleIds.push(athlete_id);
      }
      if (!accessibleIds.length) return [];

      const { data } = await supabase
        .from("athlete_social_data")
        .select("athlete_id, total_followers, ig_followers, tt_followers, fb_followers, x_followers")
        .in("athlete_id", accessibleIds);

      const rows: any[] = data ?? [];
      const byId = new Map<string, any>(rows.map((r) => [r.athlete_id, r]));

      return athleteIds.map((athlete_id) => {
        const r = byId.get(athlete_id);
        if (!r) {
          return {
            athlete_id,
            following_total: null,
            ig_followers: null,
            tt_followers: null,
            fb_followers: null,
            x_followers: null,
          };
        }
        const perPlatformSum =
          (r.ig_followers ?? 0) + (r.tt_followers ?? 0) + (r.fb_followers ?? 0) + (r.x_followers ?? 0);
        return {
          athlete_id,
          following_total: r.total_followers ?? perPlatformSum,
          ig_followers: r.ig_followers ?? null,
          tt_followers: r.tt_followers ?? null,
          fb_followers: r.fb_followers ?? null,
          x_followers: r.x_followers ?? null,
        };
      });
    },

    /** High-level structured intelligence for an athlete. Use this as the primary payload for downstream reasoning agents. */
    getAthleteIntelligence: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      const payload = await buildAthleteIntelligencePayload(athlete_id);
      return payload;
    },

    generateGroupOutreachEmail: async (params: {
      recipient_name: string;
      brand_name: string;
      athletes: Array<{
        name: string;
        sport: string;
        audience_interested: number;
        interest_names: string[];
      }>;
    }) => {
      const validated = validateGroupOutreachEmailInput(params);
      if (!validated.ok) {
        return { error: validated.error };
      }
      return {
        subject: "Quick intro: The·Team x {{brand_name}}",
        body_markdown: renderGroupOutreachEmailMarkdown(validated.data),
      };
    },
    generateSingleAthleteOutreachEmail: async (params: {
      recipient_name: string;
      brand_name: string;
      athlete_name: string;
      athlete_sport: string;
      audience_insights: string[];
      open_category_reason: string;
      cta?: string;
    }) => {
      const validated = validateSingleAthleteOutreachEmailInput(params);
      if (!validated.ok) {
        return { error: validated.error };
      }
      return {
        subject: `Potential Collaboration with ${validated.data.athlete_name}`,
        body_markdown: renderSingleAthleteOutreachEmailMarkdown(validated.data),
      };
    },

    /**
     * Bulk import: create/merge CRM pipeline cards for a batch of companies and attach them all
     * to one athlete's target list (potential_athletes). Intended for parsed Excel/screenshot uploads.
     * Per-row fields mirror the target-list Excel columns so agents can dump a spreadsheet and have
     * the Mystery Machine do the CRM plumbing.
     */
    bulkImportCompaniesToCrmForAthlete: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      companies: Array<{
        company_name: string;
        category?: string;
        website?: string;
        hq_phone?: string;
        company_description?: string;
        past_partnerships?: string;
        personal_notes?: string;
        contacts?: Array<{
          first_name: string;
          last_name: string;
          role?: string;
          email?: string;
          phone?: string;
          notes?: string;
        }>;
      }>;
    }) => {
      const rows = Array.isArray(params?.companies) ? params.companies : [];
      if (rows.length === 0) {
        return { ok: false as const, error: "companies is required (empty list)" };
      }
      if (rows.length > 300) {
        return { ok: false as const, error: "Too many rows (max 300 per call)" };
      }

      // Resolve athlete. Prefer explicit athlete_id (already UUID-resolved by the chat route),
      // otherwise run the same name resolver used elsewhere so agents can say "assign to Bryce".
      let athleteId = String(params?.athlete_id ?? "").trim();
      if (athleteId && looksLikeHumanAthleteIdPlaceholder(athleteId)) athleteId = "";
      const providedName = String(params?.athlete_name ?? "").trim();

      const fetchAthleteRow = async (id: string) =>
        supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .eq("athlete_id", id)
          .maybeSingle();

      let athleteRow: { athlete_id?: string; first_name?: string | null; last_name?: string | null; sport?: string | null } | null = null;

      if (athleteId) {
        const { data } = await fetchAthleteRow(athleteId);
        athleteRow = data ?? null;
      }

      if (!athleteRow && providedName) {
        const parts = providedName.split(/\s+/).filter(Boolean);
        const first = parts.length > 1 ? parts[0] : "";
        const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";
        let q = supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name, sport")
          .limit(5);
        if (first) q = q.ilike("first_name", `%${first}%`);
        if (last) q = q.ilike("last_name", `%${last}%`);
        const { data } = await q;
        const candidates = Array.isArray(data) ? data : [];
        const exact = candidates.find((a: any) => {
          const full = [a.first_name, a.last_name].filter(Boolean).join(" ").trim().toLowerCase();
          return full === providedName.toLowerCase();
        });
        athleteRow = exact ?? candidates[0] ?? null;
      }

      if (!athleteRow?.athlete_id) {
        return {
          ok: false as const,
          error:
            "Could not resolve athlete. Pass athlete_id (UUID) or athlete_name matching exactly one athlete in the roster.",
        };
      }
      athleteId = String(athleteRow.athlete_id);

      if (!(await agentCanAccessAthlete(supabase, profile, athleteId))) {
        return { ok: false as const, error: "You do not have access to that athlete." };
      }

      const athleteFullName = [athleteRow.first_name, athleteRow.last_name]
        .map((s) => String(s ?? "").trim())
        .filter(Boolean)
        .join(" ");
      const athleteEntry = {
        athlete_id: athleteId,
        name: athleteFullName,
        sport: athleteRow.sport ?? null,
      };

      const results: Array<{
        company_name: string;
        company_id?: string;
        pipeline_id?: string;
        pipeline_created: boolean;
        athlete_linked: boolean;
        company_fields_updated: string[];
        contacts_created: number;
        contacts_existing: number;
        error?: string;
      }> = [];

      for (const raw of rows) {
        const company_name = String(raw?.company_name ?? "").trim();
        if (!company_name) {
          results.push({
            company_name: "",
            pipeline_created: false,
            athlete_linked: false,
            company_fields_updated: [],
            contacts_created: 0,
            contacts_existing: 0,
            error: "company_name missing",
          });
          continue;
        }

        try {
          // Match companies by name case-insensitively, prefer exact casing.
          const { data: coRows, error: coErr } = await supabase
            .from("companies")
            .select("company_id, name, website, hq_phone, product_category")
            .ilike("name", company_name)
            .limit(10);
          if (coErr) throw new Error(coErr.message);

          const cRows = coRows ?? [];
          const exactCo = cRows.find(
            (r: any) => String(r?.name ?? "").trim().toLowerCase() === company_name.toLowerCase()
          );
          let pickedCo: any = exactCo ?? cRows[0] ?? null;

          let companyId: string;
          if (!pickedCo?.company_id) {
            const { data: inserted, error: insErr } = await supabase
              .from("companies")
              .insert({
                name: company_name,
                industry: null,
                website: raw.website?.trim() || null,
                hq_phone: raw.hq_phone?.trim() || null,
                product_category: raw.category?.trim() || DEFAULT_COMPANY_CATEGORY,
              })
              .select("company_id, name, website, hq_phone, product_category")
              .single();
            if (insErr) throw new Error(insErr.message);
            companyId = String(inserted!.company_id);
            pickedCo = inserted;
          } else {
            companyId = String(pickedCo.company_id);
          }

          // Only fill missing company fields — do not overwrite agent-authored values.
          const companyPatch: Record<string, string | null> = {};
          if (raw.website?.trim() && !pickedCo.website) companyPatch.website = raw.website.trim();
          if (raw.hq_phone?.trim() && !pickedCo.hq_phone) companyPatch.hq_phone = raw.hq_phone.trim();
          const rowCategory = raw.category?.trim() || DEFAULT_COMPANY_CATEGORY;
          if (!pickedCo.product_category) companyPatch.product_category = rowCategory;

          if (Object.keys(companyPatch).length > 0) {
            await supabase.from("companies").update(companyPatch).eq("company_id", companyId);
          }

          // Pipeline card is scoped per user (unique (company_id, created_by_user_id)).
          const { data: existingPipe } = await supabase
            .from("crm_companies_pipeline")
            .select("id, potential_athletes, company_description, past_partnerships, personal_notes")
            .eq("company_id", companyId)
            .eq("created_by_user_id", profile.user_id)
            .maybeSingle();

          let pipelineId: string;
          let pipelineCreated = false;
          let alreadyLinked = false;

          if (existingPipe?.id) {
            pipelineId = String(existingPipe.id);
            const list = Array.isArray(existingPipe.potential_athletes) ? [...existingPipe.potential_athletes] : [];
            alreadyLinked = list.some((p: any) => String(p?.athlete_id ?? "") === athleteId);
            const nextAthletes = alreadyLinked ? list : [...list, athleteEntry];

            const pipelinePatch: Record<string, unknown> = {};
            if (!alreadyLinked) pipelinePatch.potential_athletes = nextAthletes;
            if (raw.company_description?.trim() && !existingPipe.company_description) {
              pipelinePatch.company_description = raw.company_description.trim();
            }
            if (raw.past_partnerships?.trim() && !existingPipe.past_partnerships) {
              pipelinePatch.past_partnerships = raw.past_partnerships.trim();
            }
            if (raw.personal_notes?.trim() && !existingPipe.personal_notes) {
              pipelinePatch.personal_notes = raw.personal_notes.trim();
            }
            if (Object.keys(pipelinePatch).length > 0) {
              const { error: upErr } = await supabase
                .from("crm_companies_pipeline")
                .update(pipelinePatch)
                .eq("id", pipelineId);
              if (upErr) throw new Error(upErr.message);
            }
          } else {
            const { data: created, error: cErr } = await supabase
              .from("crm_companies_pipeline")
              .insert({
                company_id: companyId,
                created_by_user_id: profile.user_id,
                status: "in_progress",
                potential_athletes: [athleteEntry],
                company_description: raw.company_description?.trim() || null,
                past_partnerships: raw.past_partnerships?.trim() || null,
                personal_notes: raw.personal_notes?.trim() || null,
              })
              .select("id")
              .single();
            if (cErr) throw new Error(cErr.message);
            pipelineId = String(created.id);
            pipelineCreated = true;
          }

          // Contacts: add rows that don't already exist for (company_id, first, last).
          const inputContacts = Array.isArray(raw.contacts) ? raw.contacts : [];
          let contactsCreated = 0;
          let contactsExisting = 0;

          if (inputContacts.length > 0) {
            const { data: existingContacts } = await supabase
              .from("crm_contacts")
              .select("contact_id, first_name, last_name")
              .eq("company_id", companyId);

            const seen = new Set<string>(
              (existingContacts ?? []).map(
                (c: any) =>
                  `${String(c.first_name ?? "").trim().toLowerCase()}||${String(c.last_name ?? "").trim().toLowerCase()}`
              )
            );

            for (const c of inputContacts) {
              const first = String(c?.first_name ?? "").trim();
              const last = String(c?.last_name ?? "").trim();
              if (!first || !last) continue;
              const key = `${first.toLowerCase()}||${last.toLowerCase()}`;
              if (seen.has(key)) {
                contactsExisting += 1;
                continue;
              }
              const { error: contactErr } = await supabase.from("crm_contacts").insert({
                company_id: companyId,
                created_by_user_id: profile.user_id,
                first_name: first,
                last_name: last,
                role: c.role?.trim() || null,
                email: c.email?.trim() || null,
                phone: c.phone?.trim() || null,
                notes: c.notes?.trim() || null,
                outreach_mode: "email",
              });
              if (contactErr) {
                // Surface first contact error but keep importing the rest of this row's contacts.
                results.push({
                  company_name,
                  company_id: companyId,
                  pipeline_id: pipelineId,
                  pipeline_created: pipelineCreated,
                  athlete_linked: !alreadyLinked,
                  company_fields_updated: Object.keys(companyPatch),
                  contacts_created: contactsCreated,
                  contacts_existing: contactsExisting,
                  error: `contact insert failed (${first} ${last}): ${contactErr.message}`,
                });
                continue;
              }
              contactsCreated += 1;
              seen.add(key);
            }
          }

          results.push({
            company_name,
            company_id: companyId,
            pipeline_id: pipelineId,
            pipeline_created: pipelineCreated,
            athlete_linked: !alreadyLinked,
            company_fields_updated: Object.keys(companyPatch),
            contacts_created: contactsCreated,
            contacts_existing: contactsExisting,
          });
        } catch (e: any) {
          results.push({
            company_name,
            pipeline_created: false,
            athlete_linked: false,
            company_fields_updated: [],
            contacts_created: 0,
            contacts_existing: 0,
            error: e?.message ?? "row failed",
          });
        }
      }

      const summary = {
        total_rows: rows.length,
        pipeline_cards_created: results.filter((r) => r.pipeline_created).length,
        pipeline_cards_updated: results.filter((r) => !r.pipeline_created && !r.error).length,
        athletes_linked: results.filter((r) => r.athlete_linked).length,
        contacts_created: results.reduce((s, r) => s + r.contacts_created, 0),
        contacts_existing: results.reduce((s, r) => s + r.contacts_existing, 0),
        errors: results.filter((r) => r.error).map((r) => ({ company: r.company_name, error: r.error })),
      };

      return {
        ok: true as const,
        athlete: { athlete_id: athleteId, name: athleteFullName, sport: athleteRow.sport ?? null },
        summary,
        results,
      };
    },
  };
}
