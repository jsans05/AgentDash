import type { SupabaseClient } from "@supabase/supabase-js";

export async function removeAthleteFromTargetListCard(
  supabase: SupabaseClient,
  userId: string,
  athleteId: string,
  pipelineId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pid = String(pipelineId ?? "").trim();
  if (!pid) return { ok: false, error: "pipeline_id is required" };

  const { data: pipe, error: readErr } = await supabase
    .from("crm_companies_pipeline")
    .select("id, potential_athletes, created_by_user_id")
    .eq("id", pid)
    .maybeSingle();

  if (readErr || !pipe) {
    return { ok: false, error: readErr?.message || "Pipeline row not found" };
  }
  if (String(pipe.created_by_user_id) !== userId) {
    return { ok: false, error: "Not your pipeline card" };
  }

  const list = Array.isArray(pipe.potential_athletes) ? [...pipe.potential_athletes] : [];
  const had = list.some((p: { athlete_id?: string }) => String(p?.athlete_id ?? "") === athleteId);
  if (!had) {
    return { ok: false, error: "Athlete was not linked on this card" };
  }

  const nextAthletes = list.filter((p: { athlete_id?: string }) => String(p?.athlete_id ?? "") !== athleteId);
  const { error: upErr } = await supabase
    .from("crm_companies_pipeline")
    .update({ potential_athletes: nextAthletes })
    .eq("id", pid)
    .eq("created_by_user_id", userId);

  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}
