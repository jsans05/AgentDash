import Link from "next/link";
import { parseRosterSort, rosterOrder, rosterSortHref } from "@/lib/roster/params";
import type { RosterSearchParams, RosterSortKey } from "@/lib/roster/types";

type SortableThProps = {
  sortKey: RosterSortKey;
  searchParams: RosterSearchParams;
  children: React.ReactNode;
  className?: string;
};

export function SortableTh({ sortKey, searchParams, children, className }: SortableThProps) {
  const currentSort = parseRosterSort(searchParams.sort);
  const currentOrder = rosterOrder(searchParams);

  return (
    <th className={className}>
      <Link
        href={rosterSortHref(searchParams, sortKey)}
        className="group inline-flex font-semibold text-[#F4F1EB] hover:text-[#CEE4D4]"
      >
        {children}
        <span className="ml-1 text-[#AFA89C] group-hover:text-[#CEE4D4]">
          {currentSort === sortKey ? (currentOrder === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );
}
