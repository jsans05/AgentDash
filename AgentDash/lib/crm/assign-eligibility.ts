import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true when assignee may receive cards for the given athletes.
 * Sales: always allowed. Agents: must be on athlete_agents for every athleteId.
 * Other roles: not allowed when athlete scope is provided.
 */
export async function isAssigneeEligibleForAthletes(
  supabaseAdmin: SupabaseClient,
  assignee: { user_id: string; role: string },
  athleteIds: string[]
): Promise<boolean> {
  const unique = [...new Set(athleteIds.map(String).filter(Boolean))];
  if (unique.length === 0) {
    // No athlete scope: allow sales/admin/agent (pipeline board).
    return (
      assignee.role === "sales" ||
      assignee.role === "admin" ||
      assignee.role === "agent"
    );
  }

  if (assignee.role === "sales") return true;
  if (assignee.role !== "agent") return false;

  for (const athleteId of unique) {
    const [{ data: link, error }, { data: athlete, error: athleteErr }] = await Promise.all([
      supabaseAdmin
        .from("athlete_agents")
        .select("user_id")
        .eq("athlete_id", athleteId)
        .eq("user_id", assignee.user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("athletes")
        .select("current_agent_id")
        .eq("athlete_id", athleteId)
        .maybeSingle(),
    ]);
    if (error) throw new Error(error.message);
    if (athleteErr) throw new Error(athleteErr.message);
    const isLinked =
      Boolean(link) || String(athlete?.current_agent_id ?? "") === assignee.user_id;
    if (!isLinked) return false;
  }
  return true;
}
