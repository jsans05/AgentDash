"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatAthleteGender } from "@/lib/athletes/gender";
import { formatFollowersCount, formatLocation, formatRosterAgentsDisplay } from "@/lib/roster/format";
import type { RosterAthleteRow, RosterSearchParams } from "@/lib/roster/types";
import { SortableTh } from "@/components/roster/SortableTh";

type RosterTableProps = {
  athletes: RosterAthleteRow[];
  searchParams: RosterSearchParams;
  showAgentColumn: boolean;
  clearFiltersHref: string;
};

function ContractSignal({ athlete }: { athlete: RosterAthleteRow }) {
  if (athlete.active_contract_count === 0) {
    return <span className="text-[#8E877A]">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/contracts?athlete=${athlete.athlete_id}`}
        onClick={(e) => e.stopPropagation()}
        className="text-[#CEE4D4] hover:text-[#E8F6ED] hover:underline"
      >
        {athlete.active_contract_count} active
      </Link>
      {athlete.expiring_contract_count > 0 && (
        <span className="rounded-full border border-[#8A7348]/50 bg-[#3A3020] px-2 py-0.5 text-xs text-[#F3E4C8]">
          {athlete.expiring_contract_count} expiring
        </span>
      )}
    </div>
  );
}

function RosterRow({
  athlete,
  showAgentColumn,
}: {
  athlete: RosterAthleteRow;
  showAgentColumn: boolean;
}) {
  const router = useRouter();
  const agentDisplay = formatRosterAgentsDisplay(athlete.agents);
  const isUnassigned = showAgentColumn && !agentDisplay.primary;

  return (
    <tr
      className="cursor-pointer hover:bg-white/5"
      onClick={() => router.push(`/athlete/${athlete.athlete_id}`)}
    >
      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[#F4F1EB] sm:pl-4">
        <span className="text-[#CEE4D4]">{athlete.first_name} {athlete.last_name}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
        {formatAthleteGender(athlete.gender) ?? "—"}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">{athlete.sport || "—"}</td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
        {formatLocation(athlete.city, athlete.state, athlete.country)}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
        {formatFollowersCount(athlete.total_followers)}
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
        <ContractSignal athlete={athlete} />
      </td>
      {showAgentColumn && (
        <td className="whitespace-nowrap px-3 py-4 text-sm text-[#D7D0C4]">
          {isUnassigned ? (
            <span className="rounded-full border border-[#8A4848]/40 bg-[#2A1818] px-2 py-0.5 text-xs text-[#F1A2A2]">
              Unassigned
            </span>
          ) : (
            <span>
              {agentDisplay.primary}
              {agentDisplay.extraCount > 0 && (
                <span className="ml-1 text-xs text-[#8E877A]">+{agentDisplay.extraCount}</span>
              )}
            </span>
          )}
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-4 text-sm text-[#8E877A]">
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <Link href={`/athlete/${athlete.athlete_id}`} className="hover:text-[#CEE4D4]">
            Profile
          </Link>
          <Link href={`/athlete/${athlete.athlete_id}?tab=outreach`} className="hover:text-[#CEE4D4]">
            Outreach
          </Link>
        </div>
      </td>
    </tr>
  );
}

export function RosterTable({ athletes, searchParams, showAgentColumn, clearFiltersHref }: RosterTableProps) {
  return (
    <div className="mt-8 flow-root">
      <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
          <table className="min-w-full divide-y divide-white/15 rounded-xl border border-white/10 bg-[#121614]">
            <thead>
              <tr>
                <SortableTh sortKey="name" searchParams={searchParams} className="py-3.5 pl-4 pr-3 text-left text-sm sm:pl-4">
                  Name
                </SortableTh>
                <SortableTh sortKey="gender" searchParams={searchParams} className="px-3 py-3.5 text-left text-sm">
                  Gender
                </SortableTh>
                <SortableTh sortKey="sport" searchParams={searchParams} className="px-3 py-3.5 text-left text-sm">
                  Sport
                </SortableTh>
                <SortableTh sortKey="location" searchParams={searchParams} className="px-3 py-3.5 text-left text-sm">
                  Location
                </SortableTh>
                <SortableTh sortKey="followers" searchParams={searchParams} className="px-3 py-3.5 text-left text-sm">
                  Followers
                </SortableTh>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Contracts</th>
                {showAgentColumn && (
                  <SortableTh sortKey="agent" searchParams={searchParams} className="px-3 py-3.5 text-left text-sm">
                    Agents
                  </SortableTh>
                )}
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {athletes.length === 0 ? (
                <tr>
                  <td
                    colSpan={showAgentColumn ? 8 : 7}
                    className="px-4 py-12 text-center text-sm text-[#D7D0C4]"
                  >
                    <p>No athletes match your filters.</p>
                    <Link href={clearFiltersHref} className="mt-2 inline-block text-[#CEE4D4] hover:text-[#E8F6ED] hover:underline">
                      Clear filters
                    </Link>
                  </td>
                </tr>
              ) : (
                athletes.map((athlete) => (
                  <RosterRow key={athlete.athlete_id} athlete={athlete} showAgentColumn={showAgentColumn} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
