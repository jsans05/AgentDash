import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { fetchAthleteTargetListRows, type TargetListContact, type TargetListRow } from "@/lib/crm/athlete-target-list";
import { removeAthleteFromTargetListCard } from "@/lib/crm/remove-athlete-from-target-list";

export type { TargetListContact, TargetListRow };

/**
 * GET /api/athletes/:id/target-list
 *
 * Returns the spreadsheet-ready target list for an athlete: every pipeline card
 * (crm_companies_pipeline) where the athlete appears in `potential_athletes`,
 * plus all crm_contacts for the same company that the viewer can see (RLS
 * scopes agents to their own contacts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  try {
    const rows = await fetchAthleteTargetListRows(supabase, profile.user_id, athleteId);
    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to load target list" }, { status: 500 });
  }
}

/**
 * DELETE /api/athletes/:id/target-list
 *
 * Removes this athlete from a pipeline card's potential_athletes (company stays in CRM).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const pipelineId = String((body as { pipeline_id?: unknown }).pipeline_id ?? "").trim();
  if (!pipelineId) {
    return NextResponse.json({ error: "pipeline_id is required" }, { status: 400 });
  }

  const result = await removeAthleteFromTargetListCard(
    supabase,
    profile.user_id,
    athleteId,
    pipelineId
  );
  if (!result.ok) {
    const status = result.error === "Not your pipeline card" ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, pipeline_id: pipelineId });
}
