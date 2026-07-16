import type { RosterSearchParams, RosterSortKey } from "@/lib/roster/types";
import { ROSTER_UNASSIGNED_AGENT } from "@/lib/roster/types";

const SORT_KEYS: RosterSortKey[] = ["name", "sport", "location", "agent", "followers", "gender"];

export function parseRosterSort(sort: string | undefined): RosterSortKey {
  return SORT_KEYS.includes(sort as RosterSortKey) ? (sort as RosterSortKey) : "name";
}

export function rosterOrder(searchParams: RosterSearchParams): "asc" | "desc" {
  return searchParams.order === "desc" ? "desc" : "asc";
}

export function hasActiveRosterFilters(searchParams: RosterSearchParams): boolean {
  return Boolean(
    searchParams.search?.trim() ||
      searchParams.sport ||
      searchParams.country ||
      searchParams.gender ||
      (searchParams.agent && searchParams.agent !== "")
  );
}

export function buildRosterQueryString(
  params: RosterSearchParams,
  overrides: Partial<RosterSearchParams> = {}
): string {
  const merged = { ...params, ...overrides };
  const q = new URLSearchParams();

  if (merged.search?.trim()) q.set("search", merged.search.trim());
  if (merged.sport) q.set("sport", merged.sport);
  if (merged.country) q.set("country", merged.country);
  if (merged.gender) q.set("gender", merged.gender);
  if (merged.agent) q.set("agent", merged.agent);

  const sort = parseRosterSort(merged.sort);
  q.set("sort", sort);
  q.set("order", rosterOrder(merged));

  return q.toString();
}

export function rosterHref(params: RosterSearchParams, overrides: Partial<RosterSearchParams> = {}): string {
  const qs = buildRosterQueryString(params, overrides);
  return qs ? `/roster?${qs}` : "/roster";
}

export function rosterSortHref(params: RosterSearchParams, sortKey: RosterSortKey): string {
  const currentSort = parseRosterSort(params.sort);
  const currentOrder = rosterOrder(params);
  const order = currentSort === sortKey && currentOrder === "asc" ? "desc" : "asc";
  return rosterHref(params, { sort: sortKey, order });
}

export function rosterClearFiltersHref(params: RosterSearchParams): string {
  return rosterHref(params, {
    search: "",
    sport: "",
    country: "",
    gender: "",
    agent: "",
  });
}

export function rosterRemoveFilterHref(
  params: RosterSearchParams,
  key: keyof Pick<RosterSearchParams, "search" | "sport" | "country" | "gender" | "agent">
): string {
  return rosterHref(params, { [key]: "" });
}

export function agentFilterLabel(agentId: string, agents: { user_id: string; first_name: string | null; last_name: string | null }[]): string {
  if (agentId === ROSTER_UNASSIGNED_AGENT) return "Unassigned";
  const agent = agents.find((a) => a.user_id === agentId);
  if (!agent) return "Agent";
  return [agent.first_name, agent.last_name].filter(Boolean).join(" ").trim() || "Agent";
}
