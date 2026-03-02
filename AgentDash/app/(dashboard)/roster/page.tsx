import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import Image from "next/image";

function escapeForIlike(q: string): string {
  return q
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

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

  // Search: names, sport, city, state, country, and agent (by agent name)
  if (searchParams.search?.trim()) {
    const term = searchParams.search.trim().replace(/,/g, " "); // commas would break .or()
    const escaped = escapeForIlike(term);
    const pattern = `%${escaped}%`;
    const orParts = [
      `first_name.ilike.${pattern}`,
      `last_name.ilike.${pattern}`,
      `sport.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `state.ilike.${pattern}`,
      `country.ilike.${pattern}`,
    ];
    if (profile.role !== "agent") {
      const { data: matchingAgents } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("role", "agent")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`);
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
    query = query.order("sport", { ascending: order, nullFirst: false });
  } else if (sort === "location") {
    query = query.order("country", { ascending: order, nullFirst: false }).order("state", { ascending: order }).order("city", { ascending: order });
  } else if (sort === "agent" && profile.role !== "agent") {
    query = query.order("current_agent_id", { ascending: order, nullFirst: true });
  } else if (sort === "creatoriq") {
    query = query.order("creatoriq_publisher_id", { ascending: order, nullFirst: true });
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
        className="group inline-flex font-semibold text-gray-900 hover:text-blue-600"
      >
        {children}
        <span className="ml-1 text-gray-400 group-hover:text-blue-600">
          {currentSort === sortKey ? (currentOrder === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Roster</h1>
          <p className="mt-2 text-sm text-gray-700">
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
          className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[200px]"
        />
        <select
          name="sport"
          defaultValue={searchParams.sport}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
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
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
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
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
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
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          Search
        </button>
      </form>

      {/* Table */}
      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <SortableTh sortKey="name" className="py-3.5 pl-4 pr-3 text-left text-sm sm:pl-0">
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
                  <SortableTh sortKey="creatoriq" className="px-3 py-3.5 text-left text-sm">
                    CreatorIQ ID
                  </SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {athletes?.map((athlete: any) => (
                  <tr key={athlete.athlete_id}>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                      <Link
                        href={`/athlete/${athlete.athlete_id}`}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        {athlete.first_name} {athlete.last_name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {athlete.sport || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "—"}
                    </td>
                    {profile.role !== "agent" && (
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {athlete.profiles
                          ? `${athlete.profiles.first_name || ""} ${athlete.profiles.last_name || ""}`.trim() || athlete.profiles.email
                          : "—"}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {athlete.creatoriq_publisher_id || "—"}
                    </td>
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
