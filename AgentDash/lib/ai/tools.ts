import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import {
  resolveCompanyWebsiteForTargetList,
  websiteWasResolvedForTargetList,
} from "@/lib/crm/resolve-company-website-for-target-list";
import { findContactsForCompany } from "@/lib/apollo/find-company-contacts";
import type { Profile } from "@/lib/supabase/types";
import { fetchTaxonomyNodesForSport, normalizeCategoryForMatch } from "@/lib/taxonomy";
import { buildAthleteIntelligencePayload } from "@/lib/ai/retrieval";
import { canonicalInterestByNormalized } from "@/lib/industry-interest-map";
import { buildProspectingAudienceSignals, prioritizeProspectingCategories } from "@/lib/ai/prospecting-signals";
import {
  audiencePercentPoints,
  fmtPct,
  getAthleteAudienceProfile,
  normalizeIgAudiencePercentToFraction,
  resolveAudiencePercentFraction,
} from "@/lib/athlete-data";
import { curatePitchInterests } from "@/lib/ai/pitch-interest-curation";
import { generateSingleAthleteOutreachEmail } from "@/lib/ai/generate-single-athlete-outreach";
import {
  composePitchEmail,
  composeMultiAthletePitchEmails,
  type PitchAngle,
} from "@/lib/ai/pitch-composer";
import { searchWebCompanies as searchWebCompaniesImpl } from "@/lib/ai/tools/search-web-companies";
import { researchCompanyPartnerships as researchCompanyPartnershipsImpl } from "@/lib/ai/tools/research-company-partnerships";
import { generateCompanyDescription as generateCompanyDescriptionImpl } from "@/lib/ai/tools/generate-company-description";
import { expandSimilarCompaniesForChat } from "@/lib/ai/tools/expand-similar-companies";
import { writeUserMemory as writeUserMemoryImpl } from "@/lib/ai/tools/write-user-memory";
import { fetchPitchToneSamples } from "@/lib/ai/pitch-tone-samples";
import { stripSponsorGapCopy } from "@/lib/ai/email-copy-guard";
import type { PitchType } from "@/lib/ai/pitch-spec";
import { computeRosterAudienceSummary } from "@/lib/ai/roster-audience";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";
import { ilikeContains, normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import { fetchAthleteTargetListRows } from "@/lib/crm/athlete-target-list-server";
import { getAccessibleAthleteIds } from "@/lib/athletes/accessible";
import { upsertConsultingTargetListRows, normalizeJsonImportRow } from "@/lib/consulting/import-target-list";
import { requireConsultingProfileAccess, ConsultingAccessError } from "@/lib/consulting/access";
import { expandSimilarCompanies, loadExpandSeedsFromCompanyIds } from "@/lib/apollo/expand-similar";
import { getConsultingTargetListDomains, fetchConsultingTargetListRows } from "@/lib/crm/consulting-target-list";
import { getOrCreateCompanyByName } from "@/lib/consulting/companies";
import { assertNotBlockedCompanyName } from "@/lib/import/blocked-company-names";
import { domainFromWebsite, normalizeDomainForCompare } from "@/lib/apollo/org-search-utils";
import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import { discoverAthleteProspectsWithClaude } from "@/lib/ai/claude-prospect-discovery";
import { mergeAthleteIntoPotentialAthletes, parseOptionalMatchScore, setMatchScoreForAthlete } from "@/lib/crm/potential-athletes";
import { searchCompanies } from "@/lib/enrichment";
import { formatAthleteGender, normalizeAthleteGender } from "@/lib/athletes/gender";
import { upsertContactOutreachDraft } from "@/lib/crm/target-list-outreach";
import { searchAthletesByAudienceMatch as searchAthletesByAudienceMatchImpl } from "@/lib/ai/search-athletes-by-audience-match";

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

/** Normalize user fragments for safe use in PostgREST filters. */
function safeIlikeFragment(s: string): string {
  return String(s ?? "").trim().replace(/,/g, " ");
}

async function resolveProfileUserIdsByAgentNameSearch(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  q: string
): Promise<string[]> {
  const frag = normalizeOrIlikeFragment(q);
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
  gender: string | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  current_agent_id: string | null;
};

async function fetchRosterAthletesWithFilters(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  idFilter: string[] | null,
  filters: { country: string; city: string; state: string; sport: string; gender: string | null },
  limit: number
): Promise<RosterAthleteRow[]> {
  const selectCols =
    "athlete_id, first_name, last_name, gender, sport, city, state, country, current_agent_id";

  const applyLocationSportFilters = (q: any) => {
    let x = q;
    if (filters.country) x = x.ilike("country", ilikeContains(filters.country));
    if (filters.city) x = x.ilike("city", ilikeContains(filters.city));
    if (filters.state) x = x.ilike("state", ilikeContains(filters.state));
    if (filters.sport) x = x.ilike("sport", ilikeContains(filters.sport));
    if (filters.gender) x = x.eq("gender", filters.gender);
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
  return getAccessibleAthleteIds(supabase, profile);
}

/** Athletes included in Flow 7 "general roster": whole company for admin/sales; agent assignments for agents. */
async function getRosterAthleteIdsForProfile(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile
): Promise<string[]> {
  return getAccessibleAthleteIds(supabase, profile);
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
  /** Company rows are shared globally; CRM routes use service role for get/create. Mirror that here so agents are not blocked by stale prod RLS on `companies` INSERT/UPDATE. */
  const supabaseCompanies = await createServiceRoleClient();

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
      .select("audience_name, ig_audience_percent, ig_audience_count, current_ig_following")
      .eq("athlete_id", athlete_id)
      .eq("audience_category", category)
      .limit(Math.max(effectiveLimit, 50));
    const mapped = (data ?? []).map((row: any) => {
      const count = Number(row.ig_audience_count ?? 0);
      const fraction = resolveAudiencePercentFraction(
        Number(row.ig_audience_percent ?? 0),
        count,
        row.current_ig_following != null ? Number(row.current_ig_following) : null
      );
      return {
        audience_name: row.audience_name,
        ig_audience_percent: audiencePercentPoints(fraction),
        ig_audience_count: count,
        _fraction: fraction,
      };
    });
    mapped.sort((a, b) => b._fraction - a._fraction || b.ig_audience_count - a.ig_audience_count);
    return mapped.slice(0, effectiveLimit).map(({ _fraction, ...rest }) => rest);
  };

  const getOrCreateCompanyWithMeta = async (input: {
    name: string;
    website?: string;
    category?: string;
  }): Promise<string> => {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("company name required");
    assertNotBlockedCompanyName(name);
    const website = String(input.website ?? "").trim() || null;
    const category = String(input.category ?? "").trim() || null;

    const { data: existing } = await supabaseCompanies
      .from("companies")
      .select("company_id, website, product_category")
      .eq("name", name)
      .maybeSingle();

    let companyId: string;
    if (existing?.company_id) {
      companyId = String(existing.company_id);
      const patch: Record<string, string> = {};
      if (website && !existing.website) patch.website = website;
      if (category && isEffectivelyUncategorizedCompanyCategory(existing.product_category)) {
        patch.product_category = category;
      }
      if (Object.keys(patch).length > 0) {
        await supabaseCompanies.from("companies").update(patch).eq("company_id", companyId);
      }
    } else {
      const { data: created, error: createError } = await supabaseCompanies
        .from("companies")
        .insert({
          name,
          industry: null,
          website,
          product_category: category || DEFAULT_COMPANY_CATEGORY,
        })
        .select("company_id")
        .single();
      if (createError) throw createError;
      companyId = String(created.company_id);
    }

    await resolveCompanyWebsiteForTargetList(
      supabase,
      companyId,
      {
        companyName: name,
        productCategory: category,
        websiteHint: website,
      },
      { userId: profile.user_id }
    );

    return companyId;
  };

  const resolveAthleteIdForPipelineTools = async (params: {
    athlete_id?: string;
    athlete_name?: string;
  }): Promise<
    | { ok: false; error: string }
    | { ok: true; athleteId: string; athleteFullName: string; athleteSport: string | null }
  > => {
    let athleteId = String(params?.athlete_id ?? "").trim();
    if (athleteId && looksLikeHumanAthleteIdPlaceholder(athleteId)) athleteId = "";
    const providedName = String(params?.athlete_name ?? "").trim();

    const fetchAthleteRow = async (id: string) =>
      supabase.from("athletes").select("athlete_id, first_name, last_name, sport").eq("athlete_id", id).maybeSingle();

    let athleteRow: {
      athlete_id?: string;
      first_name?: string | null;
      last_name?: string | null;
      sport?: string | null;
    } | null = null;

    if (athleteId) {
      const { data } = await fetchAthleteRow(athleteId);
      athleteRow = data ?? null;
    }

    if (!athleteRow && providedName) {
      const parts = providedName.split(/\s+/).filter(Boolean);
      const first = parts.length > 1 ? parts[0] : "";
      const last = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "";
      let q = supabase.from("athletes").select("athlete_id, first_name, last_name, sport").limit(5);
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

    return {
      ok: true as const,
      athleteId,
      athleteFullName,
      athleteSport: athleteRow.sport ?? null,
    };
  };

  type PushEmailToCrmSingleParams = {
    company_name: string;
    contact_id?: string;
    athlete_id?: string;
    email_subject: string;
    email_body: string;
    label?: string;
  };

  const pushSingleEmailToCrm = async (params: PushEmailToCrmSingleParams) => {
    const company_name = String(params.company_name ?? "").trim();
    const email_subject = String(params.email_subject ?? "").trim();
    const email_body = stripSponsorGapCopy(String(params.email_body ?? ""));
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
      const { data: inserted, error: insErr } = await supabaseCompanies
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
  };

  return {
    getDistinctAudienceInterests: async () => {
      /** Strict canonical IG "Interests" taxonomy only. Do not merge raw DB audience_name values — they often include legacy typos, sports roster strings, and non-taxonomy labels that pollute Flow 7 / email pickers. */
      const interests = [...APPROVED_INTEREST_CATEGORIES].sort((a, b) => a.localeCompare(b));
      return { interests };
    },

    getRosterAudienceSummary: async (params: { interest_names: string[] }) => {
      const interest_names = Array.isArray(params.interest_names)
        ? params.interest_names.map((s) => String(s ?? "").trim()).filter(Boolean)
        : [];
      return computeRosterAudienceSummary(supabase, profile, interest_names);
    },

    curatePitchInterests: async (params: {
      pitch_type: PitchType;
      company_name: string;
      target_industry_or_category?: string | null;
      athlete_id?: string | null;
      max_suggestions?: number;
    }) => {
      const pitch_type = params.pitch_type;
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };
      if (!pitch_type) return { error: "pitch_type is required" };
      const athlete_id = params.athlete_id?.trim() || null;
      if (
        (pitch_type === "single_athlete" ||
          pitch_type === "multi_athlete_per_contact" ||
          pitch_type === "multi_athlete_combined") &&
        athlete_id &&
        !(await agentCanAccessAthlete(supabase, profile, athlete_id))
      ) {
        return { error: "Cannot access this athlete" };
      }
      return curatePitchInterests({
        supabase,
        profile,
        pitch_type,
        company_name,
        target_industry_or_category: params.target_industry_or_category,
        athlete_id,
        max_suggestions: params.max_suggestions,
      });
    },

    composePitchEmail: async (params: {
      pitch_type: PitchType;
      company_name: string;
      interest_names: string[];
      pitch_angles?: PitchAngle[];
      recipient_name?: string;
      target_industry_or_category?: string | null;
      athlete_id?: string | null;
      athlete_ids?: string[];
      past_partnerships?: string | null;
      company_description?: string | null;
      personal_notes?: string | null;
      open_category_reason?: string | null;
      cta?: string;
      sender_display_name?: string;
      revision_hint?: string | null;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };
      const pitch_type = params.pitch_type;
      if (!pitch_type) return { error: "pitch_type is required" };
      const interest_names = Array.isArray(params.interest_names)
        ? params.interest_names.map((s) => String(s ?? "").trim()).filter(Boolean)
        : [];
      if (!interest_names.length) {
        return { error: "interest_names is required (use curatePitchInterests suggestions or user selections)" };
      }

      const pitch_angles = Array.isArray(params.pitch_angles)
        ? params.pitch_angles
            .map((angle): PitchAngle | null => {
              if (!angle || typeof angle !== "object") return null;
              const kind = String((angle as PitchAngle).kind ?? "").trim();
              switch (kind) {
                case "interest": {
                  const name = String((angle as { name?: string }).name ?? "").trim();
                  return name ? { kind: "interest", name } : null;
                }
                case "age": {
                  const cohort = String((angle as { cohort?: string }).cohort ?? "").trim();
                  return cohort ? { kind: "age", cohort } : null;
                }
                case "gender": {
                  const value = String((angle as { value?: string }).value ?? "").trim();
                  return value ? { kind: "gender", value } : null;
                }
                case "country": {
                  const name = String((angle as { name?: string }).name ?? "").trim();
                  return name ? { kind: "country", name } : null;
                }
                case "brand_affinity": {
                  const brand = String((angle as { brand?: string }).brand ?? "").trim();
                  return brand ? { kind: "brand_affinity", brand } : null;
                }
                default:
                  return null;
              }
            })
            .filter((angle): angle is PitchAngle => angle != null)
        : undefined;

      const toneSamples = await fetchPitchToneSamples(supabase, profile.user_id);

      const athlete_ids = Array.isArray(params.athlete_ids)
        ? params.athlete_ids.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [];

      if (
        (pitch_type === "multi_athlete_per_contact" || pitch_type === "multi_athlete_combined") &&
        athlete_ids.length > 0
      ) {
        for (const aid of athlete_ids) {
          if (!(await agentCanAccessAthlete(supabase, profile, aid))) {
            return { error: `Cannot access athlete ${aid}` };
          }
        }
        if (pitch_type === "multi_athlete_per_contact") {
          const emails = await composeMultiAthletePitchEmails({
            supabase,
            profile,
            company_name,
            interest_names,
            athlete_ids,
            recipient_name: params.recipient_name,
            target_industry_or_category: params.target_industry_or_category,
            past_partnerships: params.past_partnerships,
            company_description: params.company_description,
            personal_notes: params.personal_notes,
            open_category_reason: params.open_category_reason,
            cta: params.cta,
            sender_display_name: params.sender_display_name,
            toneSamples,
            revisionHint: params.revision_hint,
          });
          return {
            emails: emails.map((e) => ({
              subject: e.subject,
              body: e.body,
              body_markdown: e.body_markdown,
              pitch_type: e.pitch_type,
              polished: e.polished ?? false,
              fallback_used: e.fallback_used ?? false,
            })),
          };
        }
      }

      const athlete_id = params.athlete_id?.trim() || athlete_ids[0] || null;
      if (athlete_id && !(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return { error: "Cannot access this athlete" };
      }

      const revisionHint = String(params.revision_hint ?? "").trim() || null;

      if (pitch_type === "single_athlete" && athlete_id && !revisionHint) {
        const composed = await generateSingleAthleteOutreachEmail({
          supabase,
          profile,
          athlete_id,
          company_name,
          interest_names,
          pitch_angles: pitch_angles?.length ? pitch_angles : undefined,
          recipient_name: params.recipient_name,
          target_industry_or_category: params.target_industry_or_category,
          past_partnerships: params.past_partnerships,
          company_description: params.company_description,
          personal_notes: params.personal_notes,
          open_category_reason: params.open_category_reason,
          cta: params.cta,
          sender_display_name: params.sender_display_name,
          autoCurateInterests: false,
        });
        return {
          subject: composed.subject,
          body: composed.body,
          body_markdown: composed.body_markdown,
          pitch_type: composed.pitch_type,
          used_interests: composed.used_interests,
          word_count: composed.word_count,
          max_words: composed.max_words,
          within_word_limit: composed.within_word_limit,
          curation_rationale: composed.curation_rationale,
          polished: composed.polished ?? false,
          fallback_used: composed.fallback_used ?? false,
        };
      }

      const composed = await composePitchEmail({
        supabase,
        profile,
        pitch_type,
        company_name,
        interest_names,
        pitch_angles,
        recipient_name: params.recipient_name,
        target_industry_or_category: params.target_industry_or_category,
        athlete_id,
        athlete_ids: pitch_type === "multi_athlete_combined" ? athlete_ids : undefined,
        past_partnerships: params.past_partnerships,
        company_description: params.company_description,
        personal_notes: params.personal_notes,
        open_category_reason: params.open_category_reason,
        cta: params.cta,
        sender_display_name: params.sender_display_name,
        toneSamples,
        revisionHint,
      });

      return {
        subject: composed.subject,
        body: composed.body,
        body_markdown: composed.body_markdown,
        pitch_type: composed.pitch_type,
        used_interests: composed.used_interests,
        word_count: composed.word_count,
        max_words: composed.max_words,
        within_word_limit: composed.within_word_limit,
        curation_rationale: composed.curation_rationale,
        polished: composed.polished ?? false,
        fallback_used: composed.fallback_used ?? false,
      };
    },

    mergePitchEmails: async (params: {
      company_name: string;
      athlete_ids: string[];
      interest_names: string[];
      target_industry_or_category?: string | null;
      past_partnerships?: string | null;
      recipient_name?: string;
      cta?: string;
      sender_display_name?: string;
      revision_hint?: string | null;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };
      const athlete_ids = Array.isArray(params.athlete_ids)
        ? params.athlete_ids.map((id) => String(id ?? "").trim()).filter(Boolean)
        : [];
      if (athlete_ids.length < 2) {
        return { error: "mergePitchEmails requires at least two athlete_ids" };
      }
      const interest_names = Array.isArray(params.interest_names)
        ? params.interest_names.map((s) => String(s ?? "").trim()).filter(Boolean)
        : [];
      if (!interest_names.length) {
        return { error: "interest_names is required (from thread selections or curatePitchInterests)" };
      }
      for (const aid of athlete_ids) {
        if (!(await agentCanAccessAthlete(supabase, profile, aid))) {
          return { error: `Cannot access athlete ${aid}` };
        }
      }
      const toneSamples = await fetchPitchToneSamples(supabase, profile.user_id);
      const composed = await composePitchEmail({
        supabase,
        profile,
        pitch_type: "multi_athlete_combined",
        company_name,
        interest_names,
        athlete_ids,
        recipient_name: params.recipient_name,
        target_industry_or_category: params.target_industry_or_category,
        past_partnerships: params.past_partnerships,
        cta: params.cta,
        sender_display_name: params.sender_display_name,
        toneSamples,
        revisionHint: params.revision_hint,
      });
      return {
        subject: composed.subject,
        body: composed.body,
        body_markdown: composed.body_markdown,
        pitch_type: composed.pitch_type,
        used_interests: composed.used_interests,
        polished: composed.polished ?? false,
        fallback_used: composed.fallback_used ?? false,
      };
    },

    getCrmCompanyContext: async (params: { company_name: string }) => {
      const rawName = String(params.company_name ?? "").trim();
      if (!rawName) return { company_name: "", found: false as const };

      const { data: companyRows, error: companyErr } = await supabase
        .from("companies")
        .select("company_id, name")
        .ilike("name", ilikeContains(rawName))
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

    searchAthletesByAudienceMatch: async (params: {
      interest_names?: string[];
      sports?: string[];
      interest_keywords?: string[];
      min_total_followers?: number;
      limit?: number;
    }) => searchAthletesByAudienceMatchImpl(supabase, profile, params),

    listAthletesScoped: async (params?: { sport?: string }) => {
      let query = supabase.from("athletes").select("athlete_id, first_name, last_name, gender, sport, country, creatoriq_publisher_id");
      if (profile.role === "agent") {
        const ids = await getAgentAccessibleAthleteIds(supabase, profile);
        if (!ids.length) return [];
        query = query.in("athlete_id", ids);
      }
      if (params?.sport?.trim()) {
        query = query.ilike("sport", ilikeContains(params.sport.trim()));
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
      gender?: string;
      agent_name?: string;
      limit?: number;
    }) => {
      const limit = Math.min(Math.max(Number(params.limit) || 150, 1), 400);
      const genderFilter = normalizeAthleteGender(params.gender ?? "");
      const filters = {
        country: safeIlikeFragment(params.country ?? ""),
        city: safeIlikeFragment(params.city ?? ""),
        state: safeIlikeFragment(params.state ?? ""),
        sport: safeIlikeFragment(params.sport ?? ""),
        gender: genderFilter,
      };
      const agentName = safeIlikeFragment(params.agent_name ?? "");

      const hasFilter = Boolean(
        filters.country || filters.city || filters.state || filters.sport || filters.gender || agentName
      );
      if (!hasFilter) {
        return {
          error:
            "Provide at least one filter: country, city, state, sport, gender, or agent_name. For sport-only lists without other criteria, use listAthletesScoped.",
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
            gender: r.gender,
            gender_display: formatAthleteGender(r.gender as any),
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


    pushCompanyToCrmPipeline: async (params: {
      company_name: string;
      category?: string;
      website?: string;
      notes?: string;
      support_email?: string;
      contact_emails?: string[];
      /** Optional — when set, the athlete is merged into the card's potential_athletes so it shows up on the target list view. Accepts UUID or full name. */
      athlete_id?: string;
      athlete_name?: string;
      /** Optional athlete–company fit score for target-list sorting (higher = better match). */
      match_score?: number;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };

      const desiredCategory = String(params.category ?? "").trim() || DEFAULT_COMPANY_CATEGORY;
      const company_id = await getOrCreateCompanyWithMeta({
        name: company_name,
        website: params.website,
        category: desiredCategory,
      });
      const { data: companyRow, error: companyReadError } = await supabase
        .from("companies")
        .select("product_category")
        .eq("company_id", company_id)
        .maybeSingle();
      if (companyReadError) return { error: companyReadError.message };
      if (isEffectivelyUncategorizedCompanyCategory(companyRow?.product_category)) {
        const { error: categoryErr } = await supabaseCompanies
          .from("companies")
          .update({ product_category: desiredCategory })
          .eq("company_id", company_id);
        if (categoryErr) return { error: categoryErr.message };
      }
      const contact_emails = normalizeEmails(params.contact_emails);
      const support_email = String(params.support_email ?? "").trim().toLowerCase() || null;
      const notes = params.notes != null ? String(params.notes) : null;

      // Resolve optional athlete so the card appears on /athlete/:id/target-list. Accepts UUID or name.
      let athleteEntry: {
        athlete_id: string;
        name: string;
        sport: string | null;
        match_score?: number | null;
      } | null = null;
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

      const matchScore = parseOptionalMatchScore(params.match_score);
      if (athleteEntry && matchScore != null) {
        athleteEntry = { ...athleteEntry, match_score: matchScore };
      }

      const { data: existing } = await supabase
        .from("crm_companies_pipeline")
        .select("id, contact_emails, potential_athletes")
        .eq("company_id", company_id)
        .eq("created_by_user_id", profile.user_id)
        .maybeSingle();

      if (existing) {
        const mergedEmails = normalizeEmails([...(existing.contact_emails ?? []), ...contact_emails]);
        let alreadyLinked = false;
        let nextAthletes = Array.isArray(existing.potential_athletes) ? [...existing.potential_athletes] : [];
        if (athleteEntry) {
          const merged = mergeAthleteIntoPotentialAthletes(existing.potential_athletes, athleteEntry);
          alreadyLinked = merged.alreadyLinked;
          nextAthletes = merged.next;
        }
        const updatePatch: Record<string, unknown> = {
          support_email,
          notes,
          contact_emails: mergedEmails,
          status: "in_progress",
        };
        if (athleteEntry && (!alreadyLinked || matchScore != null)) {
          updatePatch.potential_athletes = nextAthletes;
        }
        const { data: updated, error: updateError } = await supabase
          .from("crm_companies_pipeline")
          .update(updatePatch)
          .eq("id", existing.id)
          .select("id, company_id, status, support_email, contact_emails, notes, potential_athletes")
          .single();
        if (updateError) return { error: updateError.message };
        const { data: websiteRow } = await supabaseCompanies
          .from("companies")
          .select("website")
          .eq("company_id", company_id)
          .maybeSingle();
        const website = websiteRow?.website ? String(websiteRow.website).trim() : null;
        return {
          created: false,
          company_name,
          website,
          website_missing: !website,
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
      const { data: websiteRow } = await supabaseCompanies
        .from("companies")
        .select("website")
        .eq("company_id", company_id)
        .maybeSingle();
      const website = websiteRow?.website ? String(websiteRow.website).trim() : null;
      return {
        created: true,
        company_name,
        website,
        website_missing: !website,
        record: created,
        athlete_linked: Boolean(athleteEntry),
        athlete: athleteEntry ?? null,
      };
    },


    pushEmailToCrm: async (params: {
      company_name?: string;
      contact_id?: string;
      athlete_id?: string;
      email_subject?: string;
      email_body?: string;
      label?: string;
      emails?: PushEmailToCrmSingleParams[];
    }) => {
      const emails = Array.isArray(params.emails) ? params.emails : [];
      if (emails.length > 0) {
        if (emails.length > 50) {
          return { ok: false as const, error: "Too many emails (max 50 per call)" };
        }
        const results: Array<{ company_name: string; ok: boolean; error?: string }> = [];
        for (const entry of emails) {
          const company_name = String(entry?.company_name ?? "").trim() || "(unknown)";
          try {
            const result = await pushSingleEmailToCrm(entry);
            if (result.ok) {
              results.push({
                company_name: String(result.company_name ?? company_name),
                ok: true,
              });
            } else {
              results.push({ company_name, ok: false, error: result.error });
            }
          } catch (e: any) {
            results.push({
              company_name,
              ok: false,
              error: e?.message ?? "Tool execution failed",
            });
          }
        }
        const succeeded = results.filter((r) => r.ok).length;
        const failed = results.length - succeeded;
        return {
          ok: failed === 0,
          results,
          summary: { total: results.length, succeeded, failed },
        };
      }
      return pushSingleEmailToCrm(params as PushEmailToCrmSingleParams);
    },

    getAthleteAudienceByCategory: async (params: {
      athlete_id: string;
      category: "Brands" | "Cities" | "Combined_Age" | "Countries" | "Ethnicity" | "Gender" | "Interests" | "States";
      limit?: number;
    }) => {
      return fetchAudienceByCategory(params.athlete_id, params.category, params.limit);
    },

    getAthleteFullAudienceProfile: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      const [profileData, athleteRes] = await Promise.all([
        getAthleteAudienceProfile(supabase, athlete_id),
        supabase.from("athletes").select("athlete_id, first_name, last_name").eq("athlete_id", athlete_id).maybeSingle(),
      ]);
      const pct2 = (n: number | null | undefined) => (n == null ? null : Number((n * 100).toFixed(2)));
      const mapNameRows = (rows: Array<{ audience_name: string; ig_audience_percent: number; ig_audience_count: number }>) =>
        rows.map((r) => ({
          name: r.audience_name,
          ig_audience_percent: audiencePercentPoints(Number(r.ig_audience_percent ?? 0)),
          ig_audience_count: Number(r.ig_audience_count ?? 0),
        }));
      const normalizeGenderValue = (label: string) =>
        String(label ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_");
      const athlete = athleteRes.data;
      const athlete_name = athlete
        ? `${String(athlete.first_name ?? "").trim()} ${String(athlete.last_name ?? "").trim()}`.trim()
        : null;

      return {
        athlete_id,
        athlete_name,
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
        interests: mapNameRows(profileData.interests),
        gender: profileData.gender.map((r) => ({
          value: normalizeGenderValue(r.audience_name),
          ig_audience_percent: audiencePercentPoints(Number(r.ig_audience_percent ?? 0)),
          ig_audience_count: Number(r.ig_audience_count ?? 0),
        })),
        age: profileData.age.map((r) => ({
          cohort: r.audience_name,
          ig_audience_percent: audiencePercentPoints(Number(r.ig_audience_percent ?? 0)),
          ig_audience_count: Number(r.ig_audience_count ?? 0),
        })),
        ethnicity: mapNameRows(profileData.ethnicity),
        countries: mapNameRows(profileData.countries),
        brands: mapNameRows(profileData.brands),
      };
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
        .select("athlete_id, first_name, last_name, sport, gender, accolades, notes")
        .eq("athlete_id", athlete_id)
        .single();
      if (!athlete) return null;

      // 2. Get athlete's covered categories (DO NOT suggest companies in these)
      const { data: coveredRaw } = await supabase
        .from("athlete_covered_categories")
        .select("taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)")
        .eq("athlete_id", athlete_id);
      const coveredCategories: string[] = (coveredRaw ?? [])
        .map((r: any) => r.sponsorship_taxonomies?.category)
        .filter(Boolean);

      // 3. Get athlete's existing contracts (DO NOT suggest companies already contracted)
      const { data: contractsRaw } = await supabase
        .from("contracts")
        .select("contract_id, company_id, category")
        .eq("athlete_id", athlete_id)
        .eq("archived", false)
        .in("status", ["active"]);

      const contractIds = (contractsRaw ?? []).map((c: any) => c.contract_id).filter(Boolean);
      const { data: exclusivitiesRaw } = contractIds.length
        ? await supabase
            .from("contract_exclusivities")
            .select("taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)")
            .in("contract_id", contractIds)
        : { data: [] };

      const existingCompanyIds = new Set((contractsRaw ?? []).map((c: any) => c.company_id).filter(Boolean));
      const existingCategories: string[] = [
        ...new Set([
          ...(contractsRaw ?? []).map((c: any) => c.category).filter(Boolean),
          ...(exclusivitiesRaw ?? []).map((e: any) => e.sponsorship_taxonomies?.category).filter(Boolean),
          ...coveredCategories,
        ]),
      ];

      const restrictedTaxonomyIds = new Set<string>([
        ...(coveredRaw ?? []).map((r: any) => String(r.taxonomy_id ?? "")).filter(Boolean),
        ...(exclusivitiesRaw ?? []).map((e: any) => String(e.taxonomy_id ?? "")).filter(Boolean),
      ]);

      // 4. Get top brand affinities from athlete's audience
      //    These are brands the athlete's audience already follows/knows.
      const audienceSummary = await getAthleteAudienceProfile(supabase, athlete_id);
      const audienceSignals = buildProspectingAudienceSignals(audienceSummary);

      // 6. Get taxonomy for athlete's sport to identify open categories
      const taxonomyNodes = await fetchTaxonomyNodesForSport(athlete.sport ?? null);
      const allTaxonomyCategories = taxonomyNodes.map((node) => node.category);
      const categoryToTaxonomyId = new Map<string, string>();
      for (const node of taxonomyNodes) {
        categoryToTaxonomyId.set(normalizeCategoryForMatch(node.category), node.id);
      }

      const blockedCategorySet = new Set(existingCategories.map((c) => normalizeCategoryForMatch(c)));
      const openCategories = allTaxonomyCategories.filter((category) => {
        const normalized = normalizeCategoryForMatch(category);
        const taxonomyId = categoryToTaxonomyId.get(normalized);
        if (blockedCategorySet.has(normalized)) return false;
        if (taxonomyId && restrictedTaxonomyIds.has(taxonomyId)) return false;
        return true;
      });

      const prioritized = prioritizeProspectingCategories({
        categories: openCategories,
        categoryHint: params.category_hint ?? null,
        athleteNotes: String(athlete.notes ?? ""),
      });

      // 7. Build brand targets from audience brand affinity data
      const brandTargets = audienceSignals.topBrandAffinities.map((row) => ({
          company_name: row.name,
          source: "audience_brand_affinity" as const,
          ig_audience_percent: row.percent / 100,
          ig_audience_pct_display: `${row.percent.toFixed(1)}%`,
          ig_audience_count: null,
          rationale: `${row.percent.toFixed(1)}% of ${athlete.first_name}'s audience already follows this brand`,
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
          gender: athlete.gender ?? null,
          accolades: athlete.accolades ?? [],
          notes: athlete.notes ?? null,
        },
        context: {
          existing_sponsor_categories: existingCategories,
          covered_categories: coveredCategories,
          open_taxonomy_categories: prioritized.orderedCategories,
          prioritized_open_categories: prioritized.prioritizedCategories,
          unmet_priority_terms: prioritized.unmatchedPriorityTerms,
          restricted_taxonomy_ids: Array.from(restrictedTaxonomyIds),
          category_hint: params.category_hint ?? null,
        },
        audience_brand_targets: brandTargets.slice(0, limit),
        top_interests: audienceSignals.topInterests.slice(0, 10).map((row) => ({
          interest: row.name,
          pct_display: `${row.percent.toFixed(1)}%`,
          ig_audience_percent: row.percent / 100,
        })),
        demographics: {
          age_bands: audienceSignals.ageBands,
          gender_split: audienceSignals.genderSplit,
          top_countries: audienceSignals.topCountries,
          inferred_fit_notes: audienceSignals.demographicInferences,
        },
        known_company_targets: knownTargets.slice(0, 20),
        open_categories: prioritized.orderedCategories,
      };
    },

    generateAthleteProspectList: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      category_hint?: string;
      categories?: string[];
      min_per_category?: number;
      revenue_range_min?: number;
      revenue_range_max?: number;
      organization_locations?: string[];
      user_request?: string;
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };
      if (!(await agentCanAccessAthlete(supabase, profile, resolved.athleteId))) {
        return { ok: false as const, error: "Unauthorized athlete access" };
      }

      try {
        const discovery = await discoverAthleteProspectsWithClaude(supabase, {
          athleteId: resolved.athleteId,
          userId: profile.user_id,
          categoryHint: params.category_hint,
          categoriesOverride: Array.isArray(params.categories) ? params.categories : undefined,
          minPerCategory: params.min_per_category,
          revenueRangeMin: params.revenue_range_min,
          revenueRangeMax: params.revenue_range_max,
          organizationLocations: params.organization_locations,
          userRequestText: params.user_request,
        });
        if (!discovery) return { ok: false as const, error: "Athlete not found" };

        return {
          ok: true as const,
          athlete: {
            athlete_id: resolved.athleteId,
            name: discovery.athleteName,
            sport: discovery.sport,
          },
          markdown: discovery.markdown,
          rows: discovery.rows.map((r) => ({
            company_name: r.company_name,
            category: r.category,
            website: r.website,
            match_score: r.match_score,
          })),
          categories_searched: Object.keys(discovery.groupedCandidates),
          prioritized_categories: discovery.prioritizedCategories,
          blocked_companies: discovery.blockedCompanies,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Prospect discovery failed";
        return { ok: false as const, error: message };
      }
    },

    apolloSearchCompanies: async (params: {
      query?: string;
      keyword_tags?: string[];
      revenue_range_min?: number;
      revenue_range_max?: number;
      organization_locations?: string[];
      organization_num_employees_ranges?: string[];
      per_page?: number;
      page?: number;
    }) => {
      const keywordTags = Array.isArray(params.keyword_tags)
        ? params.keyword_tags.map((t) => String(t ?? "").trim()).filter(Boolean)
        : [];
      const query = String(params.query ?? "").trim();
      const tags = keywordTags.length > 0 ? keywordTags : query ? [query] : [];
      if (tags.length === 0) return { error: "query or keyword_tags is required" };

      try {
        const results = await searchCompanies(tags[0], {
          keyword_tags: tags,
          revenue_range_min: params.revenue_range_min,
          revenue_range_max: params.revenue_range_max,
          organization_locations: params.organization_locations,
          organization_num_employees_ranges: params.organization_num_employees_ranges,
          per_page: params.per_page ?? 15,
        });
        return results;
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Apollo company search failed" };
      }
    },

    searchWebCompanies: async (params: { query: string }) => {
      const query = String(params.query ?? "").trim();
      if (!query) return { error: "query is required" };
      return searchWebCompaniesImpl(query);
    },

    researchCompanyPartnerships: async (params: {
      company_name: string;
      website?: string | null;
      pipeline_id?: string | null;
      save_to_pipeline?: boolean;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };
      try {
        return await researchCompanyPartnershipsImpl(supabase, profile, {
          company_name,
          website: params.website,
          pipeline_id: params.pipeline_id,
          save_to_pipeline: params.save_to_pipeline,
        });
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Partnership research failed" };
      }
    },

    generateCompanyDescription: async (params: {
      company_name: string;
      pipeline_id?: string | null;
      save_to_pipeline?: boolean;
    }) => {
      const company_name = String(params.company_name ?? "").trim();
      if (!company_name) return { error: "company_name is required" };
      try {
        return await generateCompanyDescriptionImpl(supabase, profile, {
          company_name,
          pipeline_id: params.pipeline_id,
          save_to_pipeline: params.save_to_pipeline,
        });
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Failed to generate description" };
      }
    },

    expandSimilarCompanies: async (params: {
      seed_company_ids?: string[];
      seed_company_names?: string[];
      category?: string | null;
      athlete_id?: string | null;
      limit_per_seed?: number;
      organization_locations?: string[];
      revenue_range_min?: number;
      revenue_range_max?: number;
    }) => {
      try {
        return await expandSimilarCompaniesForChat(supabase, supabaseCompanies, profile, params);
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Expand similar failed" };
      }
    },

    writeUserMemory: async (params: {
      memory_notes: string[];
      scope?: "global" | "project";
      project_id?: string | null;
    }) => {
      try {
        return await writeUserMemoryImpl(supabase, profile, params);
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Failed to write user memory" };
      }
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

    /** High-level structured intelligence for an athlete. Use this as the primary payload for downstream reasoning agents. */
    getAthleteIntelligence: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      const payload = await buildAthleteIntelligencePayload(athlete_id);
      return payload;
    },

    /**
     * Bulk import: create/merge CRM pipeline cards for a batch of companies and attach them all
     * to one athlete's target list (potential_athletes). Intended for parsed Excel/screenshot uploads.
     * Per-row fields mirror the target-list Excel columns so agents can dump a spreadsheet and have
     * the Mystery Machine do the CRM plumbing. Optional outreach_email_subject / outreach_email map
     * to the Email Subject and Outreach Email columns (filled on pipeline only when previously blank).
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
        outreach_email_subject?: string;
        outreach_email?: string;
        match_score?: number;
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

      const resolvedAthlete = await resolveAthleteIdForPipelineTools(params);
      if (!resolvedAthlete.ok) {
        return { ok: false as const, error: resolvedAthlete.error };
      }
      const athleteId = resolvedAthlete.athleteId;
      const athleteFullName = resolvedAthlete.athleteFullName;
      const athleteEntry = {
        athlete_id: athleteId,
        name: athleteFullName,
        sport: resolvedAthlete.athleteSport,
        match_score: null as number | null,
      };

      const results: Array<{
        company_name: string;
        company_id?: string;
        pipeline_id?: string;
        pipeline_created: boolean;
        athlete_linked: boolean;
        company_fields_updated: string[];
        website_resolved?: boolean;
        contacts_created: number;
        contacts_existing: number;
        error?: string;
      }> = [];
      let websitesResolved = 0;

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
          assertNotBlockedCompanyName(company_name);
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
            const { data: inserted, error: insErr } = await supabaseCompanies
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
          const explicitCategory = raw.category?.trim() || null;
          if (isEffectivelyUncategorizedCompanyCategory(pickedCo.product_category)) {
            companyPatch.product_category = explicitCategory || DEFAULT_COMPANY_CATEGORY;
          }

          if (Object.keys(companyPatch).length > 0) {
            const { error: companyUpErr } = await supabaseCompanies
              .from("companies")
              .update(companyPatch)
              .eq("company_id", companyId);
            if (companyUpErr) throw new Error(companyUpErr.message);
          }

          const websiteResult = await resolveCompanyWebsiteForTargetList(
            supabase,
            companyId,
            {
              companyName: company_name,
              productCategory:
                explicitCategory || pickedCo?.product_category || DEFAULT_COMPANY_CATEGORY,
              websiteHint: raw.website?.trim() || null,
            },
            { userId: profile.user_id }
          );
          const websiteResolved = websiteWasResolvedForTargetList(websiteResult);
          if (websiteResolved) websitesResolved += 1;

          // Pipeline card is scoped per user (unique (company_id, created_by_user_id)).
          const { data: existingPipe } = await supabase
            .from("crm_companies_pipeline")
            .select(
              "id, potential_athletes, company_description, past_partnerships, personal_notes, outreach_email_subject, outreach_email"
            )
            .eq("company_id", companyId)
            .eq("created_by_user_id", profile.user_id)
            .maybeSingle();

          let pipelineId: string;
          let pipelineCreated = false;
          let alreadyLinked = false;

          const rowMatchScore = parseOptionalMatchScore(raw.match_score);
          const athleteEntryForRow = {
            ...athleteEntry,
            ...(rowMatchScore != null ? { match_score: rowMatchScore } : {}),
          };

          if (existingPipe?.id) {
            pipelineId = String(existingPipe.id);
            const merged = mergeAthleteIntoPotentialAthletes(
              existingPipe.potential_athletes,
              athleteEntryForRow
            );
            alreadyLinked = merged.alreadyLinked;

            const pipelinePatch: Record<string, unknown> = {};
            if (!alreadyLinked || rowMatchScore != null) {
              pipelinePatch.potential_athletes = merged.next;
            }
            if (raw.company_description?.trim() && !existingPipe.company_description) {
              pipelinePatch.company_description = raw.company_description.trim();
            }
            if (raw.past_partnerships?.trim() && !existingPipe.past_partnerships) {
              pipelinePatch.past_partnerships = raw.past_partnerships.trim();
            }
            if (raw.personal_notes?.trim() && !existingPipe.personal_notes) {
              pipelinePatch.personal_notes = raw.personal_notes.trim();
            }
            if (raw.outreach_email_subject?.trim() && !existingPipe.outreach_email_subject) {
              pipelinePatch.outreach_email_subject = raw.outreach_email_subject.trim();
            }
            if (raw.outreach_email?.trim() && !existingPipe.outreach_email) {
              pipelinePatch.outreach_email = raw.outreach_email.trim();
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
                potential_athletes: [athleteEntryForRow],
                company_description: raw.company_description?.trim() || null,
                past_partnerships: raw.past_partnerships?.trim() || null,
                personal_notes: raw.personal_notes?.trim() || null,
                outreach_email_subject: raw.outreach_email_subject?.trim() || null,
                outreach_email: raw.outreach_email?.trim() || null,
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
              .select("contact_id, first_name, last_name, email")
              .eq("company_id", companyId);

            const normalizeContactField = (value: unknown) => String(value ?? "").trim().toLowerCase();
            const toNameKey = (first: unknown, last: unknown) =>
              `name:${normalizeContactField(first)}||${normalizeContactField(last)}`;
            const toEmailKey = (emailValue: unknown) => {
              const normalized = normalizeContactField(emailValue);
              return normalized ? `email:${normalized}` : "";
            };

            const seen = new Set<string>();
            for (const c of existingContacts ?? []) {
              seen.add(toNameKey(c?.first_name, c?.last_name));
              const emailKey = toEmailKey(c?.email);
              if (emailKey) seen.add(emailKey);
            }

            for (const c of inputContacts) {
              const first = String(c?.first_name ?? "").trim();
              const last = String(c?.last_name ?? "").trim();
              if (!first || !last) continue;
              const nameKey = toNameKey(first, last);
              const emailKey = toEmailKey(c?.email);
              const isDuplicate = seen.has(nameKey) || (!!emailKey && seen.has(emailKey));
              if (isDuplicate) {
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
              seen.add(nameKey);
              if (emailKey) seen.add(emailKey);
            }
          }

          results.push({
            company_name,
            company_id: companyId,
            pipeline_id: pipelineId,
            pipeline_created: pipelineCreated,
            athlete_linked: !alreadyLinked,
            company_fields_updated: Object.keys(companyPatch),
            website_resolved: websiteResolved,
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
        websites_resolved: websitesResolved,
        contacts_created: results.reduce((s, r) => s + r.contacts_created, 0),
        contacts_existing: results.reduce((s, r) => s + r.contacts_existing, 0),
        errors: results.filter((r) => r.error).map((r) => ({ company: r.company_name, error: r.error })),
      };

      return {
        ok: true as const,
        athlete: { athlete_id: athleteId, name: athleteFullName, sport: resolvedAthlete.athleteSport },
        summary,
        results,
      };
    },

    getAthleteTargetList: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      uncategorized_only?: boolean;
      category_filter?: string;
      include_contacts?: boolean;
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };

      let rows;
      try {
        rows = await fetchAthleteTargetListRows(supabase, profile.user_id, resolved.athleteId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to load target list" };
      }

      if (params.uncategorized_only) {
        rows = rows.filter((r) => isEffectivelyUncategorizedCompanyCategory(r.category));
      }

      const categoryFilter = String(params.category_filter ?? "").trim();
      if (categoryFilter) {
        const needle = categoryFilter.toLowerCase();
        rows = rows.filter(
          (r) => String(r.category ?? "").trim().toLowerCase() === needle
        );
      }

      const includeContacts = Boolean(params.include_contacts);
      const slim = rows.map((r) => ({
        pipeline_id: r.pipeline_id,
        company_id: r.company_id,
        company_name: r.company_name,
        category: r.category,
        match_score: r.match_score,
        website: r.website,
        hq_phone: r.hq_phone,
        outreach_email_subject: r.outreach_email_subject,
        outreach_email: r.outreach_email,
        ...(includeContacts ? { contacts: r.contacts } : { contact_count: r.contacts.length }),
      }));

      return {
        ok: true as const,
        athlete: {
          athlete_id: resolved.athleteId,
          name: resolved.athleteFullName,
          sport: resolved.athleteSport,
        },
        row_count: slim.length,
        rows: slim,
      };
    },

    updateTargetListCompanyCategories: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      updates: Array<{ pipeline_id: string; product_category: string }>;
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };

      const updates = Array.isArray(params.updates) ? params.updates : [];
      if (updates.length === 0) return { ok: false as const, error: "updates array is required" };
      if (updates.length > 80) return { ok: false as const, error: "Too many updates (max 80 per call)" };

      let rows;
      try {
        rows = await fetchAthleteTargetListRows(supabase, profile.user_id, resolved.athleteId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to verify target list" };
      }
      const allowed = new Set(rows.map((r) => r.pipeline_id));

      const results: Array<{ pipeline_id: string; ok: boolean; error?: string; company_id?: string }> = [];

      for (const u of updates) {
        const pid = String(u.pipeline_id ?? "").trim();
        const cat = String(u.product_category ?? "").trim();
        if (!pid || !cat) {
          results.push({
            pipeline_id: pid || "(missing)",
            ok: false,
            error: "pipeline_id and non-empty product_category are required",
          });
          continue;
        }
        if (!allowed.has(pid)) {
          results.push({
            pipeline_id: pid,
            ok: false,
            error: "Pipeline row not on this athlete's target list or not owned by you",
          });
          continue;
        }
        const row = rows.find((r) => r.pipeline_id === pid);
        if (!row) {
          results.push({ pipeline_id: pid, ok: false, error: "Row not found" });
          continue;
        }
        const { error: upErr } = await supabaseCompanies
          .from("companies")
          .update({ product_category: cat })
          .eq("company_id", row.company_id);
        if (upErr) {
          results.push({ pipeline_id: pid, ok: false, error: upErr.message, company_id: row.company_id });
          continue;
        }
        results.push({ pipeline_id: pid, ok: true, company_id: row.company_id });
      }

      return {
        ok: true as const,
        athlete_id: resolved.athleteId,
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    updateTargetListMatchScores: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      updates: Array<{ pipeline_id: string; match_score: number | null }>;
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };

      const updates = Array.isArray(params.updates) ? params.updates : [];
      if (updates.length === 0) return { ok: false as const, error: "updates array is required" };
      if (updates.length > 80) return { ok: false as const, error: "Too many updates (max 80 per call)" };

      let rows;
      try {
        rows = await fetchAthleteTargetListRows(supabase, profile.user_id, resolved.athleteId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to verify target list" };
      }
      const allowed = new Set(rows.map((r) => r.pipeline_id));

      const results: Array<{ pipeline_id: string; ok: boolean; error?: string; match_score?: number | null }> = [];

      for (const u of updates) {
        const pid = String(u.pipeline_id ?? "").trim();
        if (!pid) {
          results.push({ pipeline_id: "(missing)", ok: false, error: "pipeline_id is required" });
          continue;
        }
        if (!allowed.has(pid)) {
          results.push({
            pipeline_id: pid,
            ok: false,
            error: "Pipeline row not on this athlete's target list or not owned by you",
          });
          continue;
        }
        const matchScore = parseOptionalMatchScore(u.match_score);
        if (u.match_score != null && String(u.match_score).trim() !== "" && matchScore == null) {
          results.push({ pipeline_id: pid, ok: false, error: "Invalid match_score" });
          continue;
        }

        const { data: pipe, error: readErr } = await supabase
          .from("crm_companies_pipeline")
          .select("id, potential_athletes, created_by_user_id")
          .eq("id", pid)
          .maybeSingle();
        if (readErr || !pipe) {
          results.push({ pipeline_id: pid, ok: false, error: readErr?.message || "Pipeline row not found" });
          continue;
        }
        if (String(pipe.created_by_user_id) !== profile.user_id) {
          results.push({ pipeline_id: pid, ok: false, error: "Not your pipeline card" });
          continue;
        }

        const nextAthletes = setMatchScoreForAthlete(
          pipe.potential_athletes,
          resolved.athleteId,
          matchScore
        );
        const { error: upErr } = await supabase
          .from("crm_companies_pipeline")
          .update({ potential_athletes: nextAthletes })
          .eq("id", pid)
          .eq("created_by_user_id", profile.user_id);
        if (upErr) {
          results.push({ pipeline_id: pid, ok: false, error: upErr.message });
          continue;
        }
        results.push({ pipeline_id: pid, ok: true, match_score: matchScore });
      }

      return {
        ok: true as const,
        athlete_id: resolved.athleteId,
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    removeAthleteFromTargetListCards: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      pipeline_ids: string[];
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };

      const ids = Array.isArray(params.pipeline_ids)
        ? params.pipeline_ids.map((x) => String(x ?? "").trim()).filter(Boolean)
        : [];
      if (ids.length === 0) return { ok: false as const, error: "pipeline_ids is required" };
      if (ids.length > 80) return { ok: false as const, error: "Too many ids (max 80 per call)" };

      const results: Array<{ pipeline_id: string; ok: boolean; error?: string }> = [];

      for (const pid of ids) {
        const { data: pipe, error: readErr } = await supabase
          .from("crm_companies_pipeline")
          .select("id, potential_athletes, created_by_user_id")
          .eq("id", pid)
          .maybeSingle();
        if (readErr || !pipe) {
          results.push({ pipeline_id: pid, ok: false, error: readErr?.message || "Pipeline row not found" });
          continue;
        }
        if (String(pipe.created_by_user_id) !== profile.user_id) {
          results.push({ pipeline_id: pid, ok: false, error: "Not your pipeline card" });
          continue;
        }
        const list = Array.isArray(pipe.potential_athletes) ? [...pipe.potential_athletes] : [];
        const had = list.some((p: any) => String(p?.athlete_id ?? "") === resolved.athleteId);
        const nextAthletes = list.filter((p: any) => String(p?.athlete_id ?? "") !== resolved.athleteId);
        if (!had) {
          results.push({ pipeline_id: pid, ok: false, error: "Athlete was not linked on this card" });
          continue;
        }
        const { error: upErr } = await supabase
          .from("crm_companies_pipeline")
          .update({ potential_athletes: nextAthletes })
          .eq("id", pid)
          .eq("created_by_user_id", profile.user_id);
        if (upErr) {
          results.push({ pipeline_id: pid, ok: false, error: upErr.message });
          continue;
        }
        results.push({ pipeline_id: pid, ok: true });
      }

      return {
        ok: true as const,
        athlete_id: resolved.athleteId,
        removed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    updateTargetListOutreach: async (params: {
      athlete_id?: string;
      athlete_name?: string;
      updates: Array<{
        pipeline_id: string;
        outreach_email_subject: string;
        outreach_email: string;
        contact_id?: string;
      }>;
    }) => {
      const resolved = await resolveAthleteIdForPipelineTools(params);
      if (!resolved.ok) return { ok: false as const, error: resolved.error };

      const updates = Array.isArray(params.updates) ? params.updates : [];
      if (updates.length === 0) return { ok: false as const, error: "updates array is required" };
      if (updates.length > 80) return { ok: false as const, error: "Too many updates (max 80 per call)" };

      let rows;
      try {
        rows = await fetchAthleteTargetListRows(supabase, profile.user_id, resolved.athleteId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to verify target list" };
      }
      const rowByPipeline = new Map(rows.map((r) => [r.pipeline_id, r]));

      const results: Array<{
        pipeline_id: string;
        ok: boolean;
        saved_to?: "pipeline" | "contact";
        contact_id?: string;
        contact_count?: number;
        error?: string;
      }> = [];

      for (const u of updates) {
        const pid = String(u.pipeline_id ?? "").trim();
        const subject = String(u.outreach_email_subject ?? "").trim();
        const body = stripSponsorGapCopy(String(u.outreach_email ?? ""));
        const contactId = u.contact_id != null ? String(u.contact_id).trim() : "";

        if (!pid || !subject || !body.trim()) {
          results.push({
            pipeline_id: pid || "(missing)",
            ok: false,
            error: "pipeline_id, outreach_email_subject, and outreach_email are required",
          });
          continue;
        }

        const row = rowByPipeline.get(pid);
        if (!row) {
          results.push({
            pipeline_id: pid,
            ok: false,
            error: "Pipeline row not on this athlete's target list or not owned by you",
          });
          continue;
        }

        if (contactId) {
          const contact = row.contacts.find((c) => c.contact_id === contactId);
          if (!contact) {
            results.push({
              pipeline_id: pid,
              ok: false,
              contact_id: contactId,
              error: "contact_id not found on this target list row",
            });
            continue;
          }

          const email_drafts = upsertContactOutreachDraft(
            contact.email_drafts,
            resolved.athleteId,
            subject,
            body
          );
          const { data: updatedRows, error: upCErr } = await supabase
            .from("crm_contacts")
            .update({ email_drafts })
            .eq("contact_id", contactId)
            .eq("created_by_user_id", profile.user_id)
            .select("contact_id");
          if (upCErr || !updatedRows?.length) {
            results.push({
              pipeline_id: pid,
              ok: false,
              contact_id: contactId,
              error: upCErr?.message ?? "Failed to update contact outreach draft",
            });
            continue;
          }
          results.push({
            pipeline_id: pid,
            ok: true,
            saved_to: "contact",
            contact_id: contactId,
          });
          continue;
        }

        // Target-list rows with CRM contacts display outreach on contact rows, not pipeline columns.
        if (row.contacts.length > 0) {
          let contactOk = 0;
          const contactErrors: string[] = [];
          for (const contact of row.contacts) {
            const email_drafts = upsertContactOutreachDraft(
              contact.email_drafts,
              resolved.athleteId,
              subject,
              body
            );
            const { data: updatedRows, error: upCErr } = await supabase
              .from("crm_contacts")
              .update({ email_drafts })
              .eq("contact_id", contact.contact_id)
              .eq("created_by_user_id", profile.user_id)
              .select("contact_id");
            if (upCErr || !updatedRows?.length) {
              contactErrors.push(
                `${contact.contact_id}: ${upCErr?.message ?? "Failed to update contact outreach draft"}`
              );
              continue;
            }
            contactOk += 1;
          }
          if (contactOk === 0) {
            results.push({
              pipeline_id: pid,
              ok: false,
              error: contactErrors.join("; ") || "Failed to update contact outreach drafts",
            });
            continue;
          }
          results.push({
            pipeline_id: pid,
            ok: true,
            saved_to: "contact",
            contact_count: contactOk,
          });
          continue;
        }

        const { error: upErr } = await supabase
          .from("crm_companies_pipeline")
          .update({
            outreach_email_subject: subject,
            outreach_email: body,
          })
          .eq("id", pid)
          .eq("created_by_user_id", profile.user_id);
        if (upErr) {
          results.push({ pipeline_id: pid, ok: false, error: upErr.message });
          continue;
        }
        results.push({ pipeline_id: pid, ok: true, saved_to: "pipeline" });
      }

      return {
        ok: true as const,
        athlete: {
          athlete_id: resolved.athleteId,
          name: resolved.athleteFullName,
          sport: resolved.athleteSport,
        },
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    getConsultingTargetList: async (params: {
      consulting_profile_id?: string;
      uncategorized_only?: boolean;
      category_filter?: string;
      include_contacts?: boolean;
    }) => {
      const consultingProfileId = String(params.consulting_profile_id ?? "").trim();
      if (!consultingProfileId) {
        return { ok: false as const, error: "consulting_profile_id is required" };
      }
      try {
        await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
      } catch (e) {
        if (e instanceof ConsultingAccessError) {
          return { ok: false as const, error: e.message };
        }
        throw e;
      }

      let rows;
      try {
        rows = await fetchConsultingTargetListRows(supabaseCompanies, consultingProfileId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to load consulting target list" };
      }

      if (params.uncategorized_only) {
        rows = rows.filter((r) => isEffectivelyUncategorizedCompanyCategory(r.category));
      }
      const categoryFilter = String(params.category_filter ?? "").trim();
      if (categoryFilter) {
        const needle = categoryFilter.toLowerCase();
        rows = rows.filter((r) => String(r.category ?? "").trim().toLowerCase() === needle);
      }

      const includeContacts = Boolean(params.include_contacts);
      const slim = rows.map((r) => ({
        entry_id: r.pipeline_id,
        pipeline_id: r.pipeline_id,
        company_id: r.company_id,
        company_name: r.company_name,
        category: r.category,
        website: r.website,
        hq_phone: r.hq_phone,
        company_description: r.company_description,
        personal_notes: r.personal_notes,
        ...(includeContacts ? { contacts: r.contacts } : { contact_count: r.contacts.length }),
      }));

      const { data: profileRow } = await supabase
        .from("consulting_profiles")
        .select("name")
        .eq("id", consultingProfileId)
        .maybeSingle();

      return {
        ok: true as const,
        consulting_profile_id: consultingProfileId,
        profile_name: profileRow?.name ?? null,
        row_count: slim.length,
        rows: slim,
      };
    },

    bulkImportCompaniesToConsultingTargetList: async (params: {
      consulting_profile_id?: string;
      companies: Array<Record<string, unknown>>;
    }) => {
      const consultingProfileId = String(params.consulting_profile_id ?? "").trim();
      if (!consultingProfileId) {
        return { ok: false as const, error: "consulting_profile_id is required" };
      }
      try {
        await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
      } catch (e) {
        if (e instanceof ConsultingAccessError) {
          return { ok: false as const, error: e.message };
        }
        throw e;
      }

      const rawRows = Array.isArray(params.companies) ? params.companies : [];
      if (rawRows.length === 0) {
        return { ok: false as const, error: "companies is required (empty list)" };
      }
      if (rawRows.length > 300) {
        return { ok: false as const, error: "Too many rows (max 300 per call)" };
      }

      const rows = rawRows
        .map((r) => normalizeJsonImportRow(r))
        .filter((r): r is NonNullable<typeof r> => r != null);

      if (rows.length === 0) {
        return { ok: false as const, error: "No valid company rows (company_name required)" };
      }

      try {
        const summary = await upsertConsultingTargetListRows(supabaseCompanies, {
          consultingProfileId,
          userId: profile.user_id,
          rows,
        });
        return {
          ok: true as const,
          consulting_profile_id: consultingProfileId,
          summary,
        };
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Bulk import failed" };
      }
    },

    updateConsultingTargetListCategories: async (params: {
      consulting_profile_id?: string;
      updates: Array<{ entry_id?: string; pipeline_id?: string; industry_category: string }>;
    }) => {
      const consultingProfileId = String(params.consulting_profile_id ?? "").trim();
      if (!consultingProfileId) {
        return { ok: false as const, error: "consulting_profile_id is required" };
      }
      try {
        await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
      } catch (e) {
        if (e instanceof ConsultingAccessError) {
          return { ok: false as const, error: e.message };
        }
        throw e;
      }

      const updates = Array.isArray(params.updates) ? params.updates : [];
      if (updates.length === 0) return { ok: false as const, error: "updates array is required" };
      if (updates.length > 80) return { ok: false as const, error: "Too many updates (max 80 per call)" };

      let rows;
      try {
        rows = await fetchConsultingTargetListRows(supabaseCompanies, consultingProfileId);
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Failed to verify target list" };
      }
      const allowed = new Set(rows.map((r) => r.pipeline_id));
      const results: Array<{ entry_id: string; ok: boolean; error?: string }> = [];

      for (const u of updates) {
        const entryId = String(u.entry_id ?? u.pipeline_id ?? "").trim();
        const cat = String(u.industry_category ?? "").trim();
        if (!entryId || !cat) {
          results.push({
            entry_id: entryId || "(missing)",
            ok: false,
            error: "entry_id and non-empty industry_category are required",
          });
          continue;
        }
        if (!allowed.has(entryId)) {
          results.push({
            entry_id: entryId,
            ok: false,
            error: "Entry not on this consulting target list",
          });
          continue;
        }
        const row = rows.find((r) => r.pipeline_id === entryId);
        const { error: upErr } = await supabaseCompanies
          .from("consulting_target_list")
          .update({ industry_category: cat })
          .eq("id", entryId)
          .eq("consulting_profile_id", consultingProfileId);
        if (upErr) {
          results.push({ entry_id: entryId, ok: false, error: upErr.message });
          continue;
        }
        if (row?.company_id) {
          await supabaseCompanies
            .from("companies")
            .update({ product_category: cat })
            .eq("company_id", row.company_id);
        }
        results.push({ entry_id: entryId, ok: true });
      }

      return {
        ok: true as const,
        consulting_profile_id: consultingProfileId,
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    },

    apolloExpandSimilarForConsulting: async (params: {
      consulting_profile_id?: string;
      industry_category?: string;
      seed_entry_ids?: string[];
      seed_company_ids?: string[];
      add_to_target_list?: boolean;
      limit_per_seed?: number;
    }) => {
      if (!isApolloEnabled()) {
        return { ok: false as const, error: "Apollo API is not configured on this server." };
      }
      const consultingProfileId = String(params.consulting_profile_id ?? "").trim();
      if (!consultingProfileId) {
        return { ok: false as const, error: "consulting_profile_id is required" };
      }
      const industryCategory = String(params.industry_category ?? "").trim();
      if (!industryCategory) {
        return { ok: false as const, error: "industry_category is required" };
      }
      try {
        await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
      } catch (e) {
        if (e instanceof ConsultingAccessError) {
          return { ok: false as const, error: e.message };
        }
        throw e;
      }

      let seedCompanyIds = Array.isArray(params.seed_company_ids)
        ? [...new Set(params.seed_company_ids.map((id) => String(id)).filter(Boolean))]
        : [];

      if (seedCompanyIds.length === 0 && Array.isArray(params.seed_entry_ids)) {
        const entryIds = params.seed_entry_ids.map((id) => String(id)).filter(Boolean);
        const listRows = await fetchConsultingTargetListRows(supabaseCompanies, consultingProfileId);
        for (const eid of entryIds) {
          const row = listRows.find((r) => r.pipeline_id === eid);
          if (row?.company_id) seedCompanyIds.push(row.company_id);
        }
        seedCompanyIds = [...new Set(seedCompanyIds)];
      }

      if (seedCompanyIds.length === 0) {
        const { data: seeds } = await supabaseCompanies
          .from("consulting_profile_seeds")
          .select("company_id")
          .eq("profile_id", consultingProfileId);
        for (const s of seeds ?? []) {
          if (s.company_id) seedCompanyIds.push(String(s.company_id));
        }
        seedCompanyIds = [...new Set(seedCompanyIds)];
      }

      if (seedCompanyIds.length === 0) {
        return { ok: false as const, error: "No seed companies (pass seed_company_ids or seed_entry_ids)" };
      }

      try {
        const seeds = await loadExpandSeedsFromCompanyIds(supabaseCompanies, seedCompanyIds);
        const exclude_domains = await getConsultingTargetListDomains(
          supabaseCompanies,
          consultingProfileId
        );
        for (const s of seeds) {
          const d = domainFromWebsite(s.website);
          if (d) exclude_domains.push(normalizeDomainForCompare(d));
        }

        const groups = await expandSimilarCompanies({
          seeds,
          category: industryCategory,
          limit_per_seed: params.limit_per_seed != null ? Number(params.limit_per_seed) : 5,
          exclude_domains: [...new Set(exclude_domains.map(normalizeDomainForCompare).filter(Boolean))],
        });

        let added = 0;
        const preview: Array<{ name: string; website: string | null }> = [];
        const addToList = params.add_to_target_list !== false;

        if (addToList) {
          for (const group of groups) {
            for (const org of group.similar) {
              const name = String(org.name ?? "").trim();
              if (!name) continue;
              const companyId = await getOrCreateCompanyByName(supabaseCompanies, name);
              if (org.website) {
                await supabaseCompanies
                  .from("companies")
                  .update({ website: org.website, product_category: industryCategory })
                  .eq("company_id", companyId);
              }
              const { error } = await supabaseCompanies.from("consulting_target_list").upsert(
                {
                  consulting_profile_id: consultingProfileId,
                  company_id: companyId,
                  industry_category: industryCategory,
                  added_by_user_id: profile.user_id,
                },
                { onConflict: "consulting_profile_id,company_id" }
              );
              if (!error) added++;
            }
          }
        } else {
          for (const group of groups) {
            for (const org of group.similar) {
              preview.push({
                name: String(org.name ?? ""),
                website: org.website ?? null,
              });
            }
          }
        }

        return {
          ok: true as const,
          consulting_profile_id: consultingProfileId,
          industry_category: industryCategory,
          seeds: seeds.length,
          total_similar: groups.reduce((n, g) => n + g.similar.length, 0),
          added,
          preview: preview.length > 0 ? preview : undefined,
        };
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Expand similar failed" };
      }
    },

    apolloFindContactsForCompany: async (params: { company_id?: string; company_name?: string }) => {
      if (!isApolloEnabled()) {
        return { ok: false as const, error: "Apollo API is not configured on this server." };
      }

      let companyId = params.company_id ? String(params.company_id).trim() : "";
      if (!companyId && params.company_name) {
        const name = String(params.company_name).trim();
        const { data: row } = await supabaseCompanies
          .from("companies")
          .select("company_id")
          .ilike("name", name)
          .limit(1)
          .maybeSingle();
        companyId = row?.company_id ?? "";
      }
      if (!companyId) {
        return { ok: false as const, error: "company_id or company_name required" };
      }

      try {
        const result = await findContactsForCompany(supabaseCompanies, {
          userId: profile.user_id,
          companyId,
        });
        return {
          ok: true as const,
          company_id: companyId,
          company_name: result.organization.company_name,
          found: result.found,
          created: result.created,
          updated: result.updated,
          contacts: result.contacts.map((c) => ({
            contact_id: c.contact_id,
            first_name: c.first_name,
            last_name: c.last_name,
            role: c.role,
            apollo_reveal_status: c.apollo_reveal_status,
          })),
          note: "Contacts are pending until the user clicks Reveal in the Target List or pipeline (uses Apollo credits). Default search uses Brand Design + Business Development + Partnerships with verified email, then any verified contact if no matches. Do not auto-reveal.",
        };
      } catch (e: any) {
        return { ok: false as const, error: e?.message ?? "Apollo find contacts failed" };
      }
    },
  };
}
