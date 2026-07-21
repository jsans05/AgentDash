import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";

/**
 * Athlete IDs the current user can act on for prospecting / AI tools.
 * Admin & sales: entire roster. Agent: athlete_agents ∪ current_agent_id.
 */
export async function getAccessibleAthleteIds(
  supabase: SupabaseClient,
  profile: Profile
): Promise<string[]> {
  if (profile.role === "admin" || profile.role === "sales") {
    const { data, error } = await supabase.from("athletes").select("athlete_id");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r: { athlete_id?: string }) => String(r.athlete_id ?? ""))
      .filter(Boolean);
  }

  if (profile.role === "agent") {
    const [{ data: linked }, { data: primary }] = await Promise.all([
      supabase.from("athlete_agents").select("athlete_id").eq("user_id", profile.user_id),
      supabase.from("athletes").select("athlete_id").eq("current_agent_id", profile.user_id),
    ]);
    const ids = new Set<string>();
    for (const r of linked ?? []) {
      const id = (r as { athlete_id?: string })?.athlete_id;
      if (id) ids.add(String(id));
    }
    for (const r of primary ?? []) {
      const id = (r as { athlete_id?: string })?.athlete_id;
      if (id) ids.add(String(id));
    }
    return [...ids];
  }

  return [];
}

export type MyAthlete = {
  athlete_id: string;
  name: string;
  sport: string | null;
};

export async function fetchMyAthletes(
  supabase: SupabaseClient,
  profile: Profile
): Promise<MyAthlete[]> {
  const ids = await getAccessibleAthleteIds(supabase, profile);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("athletes")
    .select("athlete_id, name, sport")
    .in("athlete_id", ids)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    athlete_id: String(r.athlete_id),
    name: String(r.name ?? "").trim() || "Unknown",
    sport: r.sport != null ? String(r.sport) : null,
  }));
}
