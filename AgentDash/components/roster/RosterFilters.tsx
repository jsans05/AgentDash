"use client";

import { useRef } from "react";
import type { RosterFilterOptions, RosterSearchParams } from "@/lib/roster/types";
import { ROSTER_UNASSIGNED_AGENT } from "@/lib/roster/types";
import { parseRosterSort, rosterOrder } from "@/lib/roster/params";

type RosterFiltersProps = {
  searchParams: RosterSearchParams;
  filterOptions: RosterFilterOptions;
  showAgentFilter: boolean;
};

export function RosterFilters({ searchParams, filterOptions, showAgentFilter }: RosterFiltersProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const currentSort = parseRosterSort(searchParams.sort);
  const currentOrder = rosterOrder(searchParams);

  const submitForm = () => {
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} method="GET" action="/roster" className="mt-4 flex flex-wrap items-center gap-4">
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
        defaultValue={searchParams.sport ?? ""}
        onChange={submitForm}
        className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
      >
        <option value="">All Sports</option>
        {filterOptions.sports.map((sport) => (
          <option key={sport} value={sport}>
            {sport}
          </option>
        ))}
      </select>
      <select
        name="country"
        defaultValue={searchParams.country ?? ""}
        onChange={submitForm}
        className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
      >
        <option value="">All Countries</option>
        {filterOptions.countries.map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </select>
      <select
        name="gender"
        defaultValue={searchParams.gender ?? ""}
        onChange={submitForm}
        className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
      >
        <option value="">All Genders</option>
        {filterOptions.genders.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {showAgentFilter && (
        <select
          name="agent"
          defaultValue={searchParams.agent ?? ""}
          onChange={submitForm}
          className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
        >
          <option value="">All Agents</option>
          <option value={ROSTER_UNASSIGNED_AGENT}>Unassigned</option>
          {filterOptions.agents.map((agent) => (
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
  );
}
