import Image from "next/image";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { RosterFilterChips } from "@/components/roster/RosterFilterChips";
import { RosterFilters } from "@/components/roster/RosterFilters";
import { RosterTable } from "@/components/roster/RosterTable";
import { hasActiveRosterFilters, rosterClearFiltersHref } from "@/lib/roster/params";
import { fetchRosterData } from "@/lib/roster/query";
import type { RosterSearchParams } from "@/lib/roster/types";

export default async function RosterPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<RosterSearchParams>;
}) {
  const searchParams = await searchParamsPromise;
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { athletes, totalUnfiltered, filterOptions, error } = await fetchRosterData(
    supabase,
    searchParams,
    { role: profile.role, user_id: profile.user_id }
  );

  const showAgentColumn = profile.role !== "agent";
  const filtersActive = hasActiveRosterFilters(searchParams);
  const filteredCount = athletes.length;

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">Roster</h1>
          <p className="mt-2 text-sm text-[#D7D0C4]">
            {filteredCount} athlete{filteredCount === 1 ? "" : "s"}
            {filtersActive && filteredCount !== totalUnfiltered
              ? ` (filtered from ${totalUnfiltered})`
              : null}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-[#8A4848]/50 bg-[#2A1818] px-4 py-3 text-sm text-[#F1A2A2]">
          Could not load roster: {error}
        </div>
      ) : null}

      <RosterFilters
        searchParams={searchParams}
        filterOptions={filterOptions}
        showAgentFilter={showAgentColumn}
      />

      <RosterFilterChips
        searchParams={searchParams}
        filterOptions={filterOptions}
        showAgentFilter={showAgentColumn}
      />

      <RosterTable
        athletes={athletes}
        searchParams={searchParams}
        showAgentColumn={showAgentColumn}
        clearFiltersHref={rosterClearFiltersHref(searchParams)}
      />

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
