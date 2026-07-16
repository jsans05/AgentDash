import type { RosterAgentInfo } from "@/lib/roster/types";

export function formatAgentName(agent: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string | null {
  if (!agent) return null;
  const name = [agent.first_name, agent.last_name].filter(Boolean).join(" ").trim();
  return name || agent.email || null;
}

export function formatRosterAgentsDisplay(agents: RosterAgentInfo[]): { primary: string | null; extraCount: number } {
  if (agents.length === 0) return { primary: null, extraCount: 0 };

  const primary =
    agents.find((a) => a.is_primary) ??
    agents[0];

  const primaryLabel = formatAgentName(primary);
  const extraCount = Math.max(0, agents.length - 1);
  return { primary: primaryLabel, extraCount };
}

export function formatFollowersCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return value.toLocaleString();
}

export function formatLocation(city: string | null, state: string | null, country: string | null): string {
  return [city, state, country].filter(Boolean).join(", ") || "—";
}
