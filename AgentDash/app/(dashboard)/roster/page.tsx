import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import Image from "next/image";
import { escapeForIlike, ilikeContains } from "@/lib/supabase/ilike";

export default async function RosterPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{
    sport?: string;
    country?: string;
    agent?: string;
    search?: string;
    sort?: string;
    order?: "asc" | "desc";
  }>;
}) {
  const searchParams = await searchParamsPromise;
  const profile = await requireProfile();
  const supabase = await createServerClient();

  // Filter by agent (admin/sales): athletes that have this agent in athlete_agents
  let agentAthleteIds: string[] | null = null;
  if (searchParams.agent && profile.role !== "agent") {
    const { data: links } = await supabase
      .from("athlete_agents")
      .select("athlete_id")
      .eq("user_id", searchParams.agent);
    agentAthleteIds = links?.map((r) => r.athlete_id) ?? [];
  }

  let query = supabase
    .from("athletes")
    .select(`
      *,
      profiles:current_agent_id (
        first_name,
        last_name,
        email
      )
    `);

  // RLS already restricts agents to their athletes (via athlete_agents)
  if (agentAthleteIds !== null) {
    if (agentAthleteIds.length === 0) query = query.eq("athlete_id", "00000000-0000-0000-0000-000000000000"); // no match
    else query = query.in("athlete_id", agentAthleteIds);
  }

  if (searchParams.sport) {
    query = query.eq("sport", searchParams.sport);
  }
  if (searchParams.country) {
    query = query.eq("country", searchParams.country);
  }

  // Search: names (incl. full "First Last"), sport, city, state, country, and agent (by agent name)
  if (searchParams.search?.trim()) {
    const term = searchParams.search.trim().replace(/,/g, " "); // commas would break .or()
    const pattern = ilikeContains(term);
    const orParts = [
      `first_name.ilike.${pattern}`,
      `last_name.ilike.${pattern}`,
      `sport.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `state.ilike.${pattern}`,
      `country.ilike.${pattern}`,
    ];

    // Multi-word search: treat as "first last" and match first_name AND last_name combinations.
    const tokens = term.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const firstTok = escapeForIlike(tokens[0]);
      const lastTok = escapeForIlike(tokens[tokens.length - 1]);
      const middleTok = escapeForIlike(tokens.slice(1).join(" "));
      const middleTokRev = escapeForIlike(tokens.slice(0, -1).join(" "));

      // Try a couple of split variants so "Mary Jane Smith" matches either split.
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

    if (profile.role !== "agent") {
      const agentOrParts = [
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
      ];
      if (tokens.length >= 2) {
        const firstTok = escapeForIlike(tokens[0]);
        const lastTok = escapeForIlike(tokens[tokens.length - 1]);
        // Match agents where first_name ~ firstTok AND last_name ~ lastTok via a second query
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
        orParts.push(`current_agent_id.in.(${agentIds.join(",")})`);
      }
    }
    query = query.or(orParts.join(","));
  }

  // Sort
  const sort = searchParams.sort || "name";
  const order = searchParams.order === "desc" ? false : true; // ascending by default
  if (sort === "name") {
    query = query.order("last_name", { ascending: order }).order("first_name", { ascending: order });
  } else if (sort === "sport") {
    query = query.order("sport", { ascending: order, nullsFirst: false });
  } else if (sort === "location") {
    query = query.order("country", { ascending: order, nullsFirst: false }).order("state", { ascending: order }).order("city", { ascending: order });
  } else if (sort === "agent" && profile.role !== "agent") {
    query = query.order("current_agent_id", { ascending: order, nullsFirst: true });
  } else {
    query = query.order("last_name", { ascending: true }).order("first_name", { ascending: true });
  }

  const { data: athletes } = await query;

  // Get filter options
  const { data: sports } = await supabase
    .from("athletes")
    .select("sport")
    .not("sport", "is", null);
  const { data: countries } = await supabase
    .from("athletes")
    .select("country")
    .not("country", "is", null);
  const { data: agents } = await supabase
    .from("profiles")
    .select("user_id, first_name, last_name")
    .eq("role", "agent");

  const uniqueSports = [...new Set(sports?.map((s) => s.sport).filter(Boolean) || [])];
  const uniqueCountries = [...new Set(countries?.map((c) => c.country).filter(Boolean) || [])];

  const currentSort = searchParams.sort || "name";
  const currentOrder = searchParams.order === "desc" ? "desc" : "asc";
  const baseParams = {
    search: searchParams.search ?? "",
    sport: searchParams.sport ?? "",
    country: searchParams.country ?? "",
    agent: searchParams.agent ?? "",
  };
  const sortLink = (sort: string) => {
    const order = currentSort === sort && currentOrder === "asc" ? "desc" : "asc";
    const q = new URLSearchParams();
    if (baseParams.search) q.set("search", baseParams.search);
    if (baseParams.sport) q.set("sport", baseParams.sport);
    if (baseParams.country) q.set("country", baseParams.country);
    if (baseParams.agent) q.set("agent", baseParams.agent);
    q.set("sort", sort);
    q.set("order", order);
    return `/roster?${q.toString()}`;
  };
  const SortableTh = ({
    sortKey,
    children,
    className,
  }: {
    sortKey: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <th className={className}>
      <Link
        href={sortLink(sortKey)}
        className="group inline-flex font-semibold text-[#F4F1EB] hover:text-[#CEE4D4]"
      >
        {children}
        <span className="ml-1 text-[#AFA89C] group-hover:text-[#CEE4D4]">
          {currentSort === sortKey ? (currentOrder === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">Roster</h1>
          <p className="mt-2 text-sm text-[#D7D0C4]">
            {athletes?.length || 0} athletes
          </p>
        </div>
      </div>

      {/* Filters: form submits as GET so search and filters apply */}
      <form method="GET" action="/roster" className="mt-4 flex flex-wrap items-center gap-4">
        <input type="hidden" name="sort" value={currentSort} />
        <input type="hidden" name="order" value={currentOrder} />
        <input
          type="text"
          name="search"
          placeholder="Search names, sport, location, agent..."
          defaultValue={searchParams.search}
          className="min-w-[240px] rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] focus:border-[#2E7040] focus:outline-none"
        />
        <select
          name="sport"
          defaultValue={searchParams.sport}
          className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
        >
          <option value="">All Sports</option>
          {uniqueSports.map((sport) => (
            <option key={sport} value={sport}>
              {sport}
            </option>
          ))}
        </select>
        <select
          name="country"
          defaultValue={searchParams.country}
          className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
        >
          <option value="">All Countries</option>
          {uniqueCountries.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
        {profile.role !== "agent" && agents && (
          <select
            name="agent"
            defaultValue={searchParams.agent}
            className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          >
            <option value="">All Agents</option>
            {agents.map((agent) => (
              <option key={agent.user_id} value={agent.user_id}>
                {agent.first_name} {agent.last_name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]"
        >
          Search
        </button>
      </form>

      {/* Table */}
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-white/15 rounded-xl border border-white/10 bg-[#121614]">
              <thead>
                <tr>
                  <SortableTh sortKey="name" className="py-3.5 pl-4 pr-3 text-left text-sm sm:pl-4">
                    Name
                  </SortableTh>
                  <SortableTh sortKey="sport" className="px-3 py-3.5 text-left text-sm">
                    Sport
                  </SortableTh>
                  <SortableTh sortKey="location" className="px-3 py-3.5 text-left text-sm">
                    Location
                  </SortableTh>
                  {profile.role !== "agent" && (
                    <SortableTh sortKey="agent" className="px-3 py-3.5 text-left text-sm">
                      Agent
                    </SortableTh>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {athletes?.map((athlete: any) => (
                  <tr key={athlete.athlete_id} className="hover:bg-white/5">
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[#F4F1EB] sm:pl-4">
                      <Link
                        href={`/athlete/${athlete.athlete_id}`}
                        className="text-[#CEE4D4] hover:text-[#E8F6ED]"
                      >
                        {athlete.first_name} {athlete.last_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
                      {athlete.sport || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
                      {[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    {profile.role !== "agent" && (
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
                        {athlete.profiles
                          ? `${athlete.profiles.first_name || ""} ${athlete.profiles.last_name || ""}`.trim() || athlete.profiles.email
                          : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Easter egg: Mystery Machine */}
      <div className="mt-12 -mx-4 sm:-mx-6 lg:-mx-8 w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+4rem)] max-w-none">
        <Image
          src="/mystery-machine-roster.png"
          alt="The Mystery Machine"
          width={1200}
          height={600}
          className="w-full h-auto rounded-none opacity-90 hover:opacity-100 transition-opacity object-cover object-center"
        />
      </div>
    </div>
  );
}
