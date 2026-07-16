import Link from "next/link";
import { formatAthleteGender, normalizeAthleteGender } from "@/lib/athletes/gender";
import {
  agentFilterLabel,
  hasActiveRosterFilters,
  rosterClearFiltersHref,
  rosterRemoveFilterHref,
} from "@/lib/roster/params";
import type { RosterFilterOptions, RosterSearchParams } from "@/lib/roster/types";

type RosterFilterChipsProps = {
  searchParams: RosterSearchParams;
  filterOptions: RosterFilterOptions;
  showAgentFilter: boolean;
};

function Chip({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#151917] px-3 py-1 text-xs text-[#D7D0C4] hover:border-[#2E7040]/50 hover:text-[#E8F6ED]"
    >
      <span>{label}</span>
      <span aria-hidden className="text-[#8E877A]">
        ×
      </span>
    </Link>
  );
}

export function RosterFilterChips({ searchParams, filterOptions, showAgentFilter }: RosterFilterChipsProps) {
  if (!hasActiveRosterFilters(searchParams)) return null;

  const chips: { label: string; href: string }[] = [];

  if (searchParams.search?.trim()) {
    chips.push({
      label: `Search: ${searchParams.search.trim()}`,
      href: rosterRemoveFilterHref(searchParams, "search"),
    });
  }
  if (searchParams.sport) {
    chips.push({
      label: `Sport: ${searchParams.sport}`,
      href: rosterRemoveFilterHref(searchParams, "sport"),
    });
  }
  if (searchParams.country) {
    chips.push({
      label: `Country: ${searchParams.country}`,
      href: rosterRemoveFilterHref(searchParams, "country"),
    });
  }
  if (searchParams.gender) {
    chips.push({
      label: `Gender: ${formatAthleteGender(normalizeAthleteGender(searchParams.gender)) ?? searchParams.gender}`,
      href: rosterRemoveFilterHref(searchParams, "gender"),
    });
  }
  if (showAgentFilter && searchParams.agent) {
    chips.push({
      label: `Agent: ${agentFilterLabel(searchParams.agent, filterOptions.agents)}`,
      href: rosterRemoveFilterHref(searchParams, "agent"),
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Chip key={chip.label} label={chip.label} href={chip.href} />
      ))}
      <Link
        href={rosterClearFiltersHref(searchParams)}
        className="text-xs text-[#CEE4D4] hover:text-[#E8F6ED] hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}
