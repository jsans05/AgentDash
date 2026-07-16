import type { SupabaseClient } from "@supabase/supabase-js";
import { ATHLETE_GENDER_OPTIONS } from "@/lib/athletes/gender";
import { buildContractSignalsByAthlete } from "@/lib/roster/contract-signals";
import { formatAgentName } from "@/lib/roster/format";
import { parseRosterSort, rosterOrder } from "@/lib/roster/params";
import type {
  RosterAgentInfo,
  RosterAthleteRow,
  RosterFilterOptions,
  RosterQueryResult,
  RosterSearchParams,
  RosterSortKey,
  RosterViewer,
} from "@/lib/roster/types";
import { ROSTER_UNASSIGNED_AGENT } from "@/lib/roster/types";
import type { AthleteGender } from "@/lib/supabase/types";
import { escapeForIlike, ilikeContains } from "@/lib/supabase/ilike";

type AthleteBaseRow = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  gender: AthleteGender | null;
  sport: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  current_agent_id: string | null;
  profiles: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

function sortAlphabetically(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function compareStrings(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function sortAthletes(rows: RosterAthleteRow[], sort: RosterSortKey, order: "asc" | "desc"): RosterAthleteRow[] {
  const dir = order === "desc" ? -1 : 1;
  const sorted = [...rows];

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "sport":
        cmp = compareStrings(a.sport, b.sport);
        break;
      case "location": {
        cmp = compareStrings(a.country, b.country);
        if (cmp === 0) cmp = compareStrings(a.state, b.state);
        if (cmp === 0) cmp = compareStrings(a.city, b.city);
        break;
      }
      case "agent": {
        const aName = formatAgentName(a.primary_agent) ?? "";
        const bName = formatAgentName(b.primary_agent) ?? "";
        cmp = compareStrings(aName, bName);
        break;
      }
      case "followers":
        cmp = (a.total_followers ?? -1) - (b.total_followers ?? -1);
        break;
      case "gender":
        cmp = compareStrings(a.gender, b.gender);
        break;
      case "name":
      default:
        cmp = compareStrings(a.last_name, b.last_name);
        if (cmp === 0) cmp = compareStrings(a.first_name, b.first_name);
        break;
    }

    if (cmp === 0) {
      cmp = compareStrings(a.last_name, b.last_name);
      if (cmp === 0) cmp = compareStrings(a.first_name, b.first_name);
    }

    return cmp * dir;
  });

  return sorted;
}

async function resolveAgentSearchAthleteIds(
  supabase: SupabaseClient,
  agentIds: string[]
): Promise<string[]> {
  if (agentIds.length === 0) return [];
  const { data } = await supabase.from("athlete_agents").select("athlete_id").in("user_id", agentIds);
  return [...new Set((data ?? []).map((r) => r.athlete_id))];
}

async function fetchFilterOptions(supabase: SupabaseClient): Promise<RosterFilterOptions> {
  const [sportsRes, countriesRes, agentsRes] = await Promise.all([
    supabase.from("athletes").select("sport").not("sport", "is", null),
    supabase.from("athletes").select("country").not("country", "is", null),
    supabase
      .from("profiles")
      .select("user_id, first_name, last_name")
      .eq("role", "agent")
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true }),
  ]);

  const uniqueSports = sortAlphabetically([
    ...new Set((sportsRes.data ?? []).map((s) => s.sport).filter(Boolean) as string[]),
  ]);
  const uniqueCountries = sortAlphabetically([
    ...new Set((countriesRes.data ?? []).map((c) => c.country).filter(Boolean) as string[]),
  ]);

  return {
    sports: uniqueSports,
    countries: uniqueCountries,
    agents: agentsRes.data ?? [],
    genders: ATHLETE_GENDER_OPTIONS,
  };
}

async function enrichAthleteRows(
  supabase: SupabaseClient,
  baseRows: AthleteBaseRow[]
): Promise<RosterAthleteRow[]> {
  if (baseRows.length === 0) return [];

  const athleteIds = baseRows.map((r) => r.athlete_id);

  const [agentLinksRes, socialRes, contractsRes] = await Promise.all([
    supabase
      .from("athlete_agents")
      .select(`
        athlete_id,
        user_id,
        is_primary,
        profiles:user_id (first_name, last_name, email)
      `)
      .in("athlete_id", athleteIds)
      .order("is_primary", { ascending: false }),
    supabase.from("athlete_social_data").select("athlete_id, total_followers").in("athlete_id", athleteIds),
    supabase
      .from("contracts")
      .select("athlete_id, status, end_date, archived")
      .in("athlete_id", athleteIds)
      .eq("archived", false),
  ]);

  const agentsByAthlete = new Map<string, RosterAgentInfo[]>();
  for (const link of agentLinksRes.data ?? []) {
    const profileRaw = link.profiles as
      | { first_name: string | null; last_name: string | null; email: string | null }
      | { first_name: string | null; last_name: string | null; email: string | null }[]
      | null;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] ?? null : profileRaw;

    const list = agentsByAthlete.get(link.athlete_id) ?? [];
    list.push({
      user_id: link.user_id,
      is_primary: link.is_primary,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      email: profile?.email ?? null,
    });
    agentsByAthlete.set(link.athlete_id, list);
  }

  const followersByAthlete = new Map<string, number>();
  for (const row of socialRes.data ?? []) {
    followersByAthlete.set(row.athlete_id, Number(row.total_followers) || 0);
  }

  const contractSignals = buildContractSignalsByAthlete(contractsRes.data ?? []);

  return baseRows.map((row) => {
    const agents = agentsByAthlete.get(row.athlete_id) ?? [];
    const contractSignal = contractSignals.get(row.athlete_id) ?? {
      active_contract_count: 0,
      expiring_contract_count: 0,
    };

    return {
      athlete_id: row.athlete_id,
      first_name: row.first_name,
      last_name: row.last_name,
      gender: row.gender,
      sport: row.sport,
      city: row.city,
      state: row.state,
      country: row.country,
      current_agent_id: row.current_agent_id,
      primary_agent: row.profiles,
      agents,
      total_followers: followersByAthlete.get(row.athlete_id) ?? null,
      active_contract_count: contractSignal.active_contract_count,
      expiring_contract_count: contractSignal.expiring_contract_count,
    };
  });
}

export async function fetchRosterData(
  supabase: SupabaseClient,
  searchParams: RosterSearchParams,
  viewer: RosterViewer
): Promise<RosterQueryResult> {
  const filterOptions = await fetchFilterOptions(supabase);

  const { count: totalUnfiltered, error: countError } = await supabase
    .from("athletes")
    .select("athlete_id", { count: "exact", head: true });

  if (countError) {
    return {
      athletes: [],
      totalUnfiltered: 0,
      filterOptions,
      error: countError.message,
    };
  }

  const sort = parseRosterSort(searchParams.sort);
  const order = rosterOrder(searchParams);
  const ascending = order === "asc";
  const inMemorySortKeys: RosterSortKey[] = ["agent", "followers"];

  let agentAthleteIds: string[] | null = null;
  let forceEmpty = false;

  if (searchParams.agent && viewer.role !== "agent") {
    if (searchParams.agent === ROSTER_UNASSIGNED_AGENT) {
      // handled via query.is below
    } else {
      const { data: links, error: agentFilterError } = await supabase
        .from("athlete_agents")
        .select("athlete_id")
        .eq("user_id", searchParams.agent);

      if (agentFilterError) {
        return {
          athletes: [],
          totalUnfiltered: totalUnfiltered ?? 0,
          filterOptions,
          error: agentFilterError.message,
        };
      }

      agentAthleteIds = links?.map((r) => r.athlete_id) ?? [];
      if (agentAthleteIds.length === 0) forceEmpty = true;
    }
  }

  if (forceEmpty) {
    return {
      athletes: [],
      totalUnfiltered: totalUnfiltered ?? 0,
      filterOptions,
      error: null,
    };
  }

  let query = supabase
    .from("athletes")
    .select(`
      athlete_id,
      first_name,
      last_name,
      gender,
      sport,
      city,
      state,
      country,
      current_agent_id,
      profiles:current_agent_id (
        first_name,
        last_name,
        email
      )
    `);

  if (agentAthleteIds !== null) {
    query = query.in("athlete_id", agentAthleteIds);
  }

  if (searchParams.agent === ROSTER_UNASSIGNED_AGENT && viewer.role !== "agent") {
    query = query.is("current_agent_id", null);
  }

  if (searchParams.sport) query = query.eq("sport", searchParams.sport);
  if (searchParams.country) query = query.eq("country", searchParams.country);
  if (searchParams.gender) query = query.eq("gender", searchParams.gender);

  if (searchParams.search?.trim()) {
    const term = searchParams.search.trim().replace(/,/g, " ");
    const pattern = ilikeContains(term);
    const orParts = [
      `first_name.ilike.${pattern}`,
      `last_name.ilike.${pattern}`,
      `sport.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `state.ilike.${pattern}`,
      `country.ilike.${pattern}`,
    ];

    const tokens = term.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const firstTok = escapeForIlike(tokens[0]);
      const lastTok = escapeForIlike(tokens[tokens.length - 1]);
      const middleTok = escapeForIlike(tokens.slice(1).join(" "));
      const middleTokRev = escapeForIlike(tokens.slice(0, -1).join(" "));

      const [fnMatches1, fnMatches2] = await Promise.all([
        supabase
          .from("athletes")
          .select("athlete_id")
          .ilike("first_name", ilikeContains(firstTok))
          .ilike("last_name", ilikeContains(middleTok)),
        supabase
          .from("athletes")
          .select("athlete_id")
          .ilike("first_name", ilikeContains(middleTokRev))
          .ilike("last_name", ilikeContains(lastTok)),
      ]);

      const nameAthleteIds = [
        ...(fnMatches1.data?.map((r) => r.athlete_id) ?? []),
        ...(fnMatches2.data?.map((r) => r.athlete_id) ?? []),
      ].filter(Boolean);

      if (nameAthleteIds.length > 0) {
        orParts.push(`athlete_id.in.(${[...new Set(nameAthleteIds)].join(",")})`);
      }
    }

    if (viewer.role !== "agent") {
      const agentOrParts = [`first_name.ilike.${pattern}`, `last_name.ilike.${pattern}`];

      if (tokens.length >= 2) {
        const firstTok = escapeForIlike(tokens[0]);
        const lastTok = escapeForIlike(tokens[tokens.length - 1]);
        const { data: fullNameAgents } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("role", "agent")
          .ilike("first_name", ilikeContains(firstTok))
          .ilike("last_name", ilikeContains(lastTok));
        const fullNameAgentIds = fullNameAgents?.map((r) => r.user_id).filter(Boolean) ?? [];
        if (fullNameAgentIds.length > 0) {
          agentOrParts.push(`user_id.in.(${fullNameAgentIds.join(",")})`);
        }
      }

      const { data: matchingAgents } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("role", "agent")
        .or(agentOrParts.join(","));

      const agentIds = matchingAgents?.map((r) => r.user_id).filter(Boolean) ?? [];
      if (agentIds.length > 0) {
        const linkedAthleteIds = await resolveAgentSearchAthleteIds(supabase, agentIds);
        if (linkedAthleteIds.length > 0) {
          orParts.push(`athlete_id.in.(${linkedAthleteIds.join(",")})`);
        }
      }
    }

    query = query.or(orParts.join(","));
  }

  if (!inMemorySortKeys.includes(sort)) {
    if (sort === "name") {
      query = query.order("last_name", { ascending }).order("first_name", { ascending });
    } else if (sort === "sport") {
      query = query.order("sport", { ascending, nullsFirst: false });
    } else if (sort === "location") {
      query = query
        .order("country", { ascending, nullsFirst: false })
        .order("state", { ascending, nullsFirst: false })
        .order("city", { ascending, nullsFirst: false });
    } else if (sort === "gender") {
      query = query.order("gender", { ascending, nullsFirst: false });
    } else {
      query = query.order("last_name", { ascending: true }).order("first_name", { ascending: true });
    }
  } else {
    query = query.order("last_name", { ascending: true }).order("first_name", { ascending: true });
  }

  const { data: athletesRaw, error: queryError } = await query;

  if (queryError) {
    return {
      athletes: [],
      totalUnfiltered: totalUnfiltered ?? 0,
      filterOptions,
      error: queryError.message,
    };
  }

  const baseRows = (athletesRaw ?? []).map((row) => {
    const profileRaw = row.profiles as
      | { first_name: string | null; last_name: string | null; email: string | null }
      | { first_name: string | null; last_name: string | null; email: string | null }[]
      | null;
    const profiles = Array.isArray(profileRaw) ? profileRaw[0] ?? null : profileRaw;

    return {
      athlete_id: row.athlete_id,
      first_name: row.first_name,
      last_name: row.last_name,
      gender: row.gender,
      sport: row.sport,
      city: row.city,
      state: row.state,
      country: row.country,
      current_agent_id: row.current_agent_id,
      profiles,
    } satisfies AthleteBaseRow;
  });
  let athletes = await enrichAthleteRows(supabase, baseRows);

  if (inMemorySortKeys.includes(sort)) {
    athletes = sortAthletes(athletes, sort, order);
  }

  return {
    athletes,
    totalUnfiltered: totalUnfiltered ?? 0,
    filterOptions,
    error: null,
  };
}
