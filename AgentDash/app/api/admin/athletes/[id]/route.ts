import { requireRole } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** DELETE /api/admin/athletes/:id — remove one athlete and cascaded related rows (admin only). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");

  const { id: athleteId } = await params;
  if (!athleteId) {
    return NextResponse.json({ error: "Athlete id required" }, { status: 400 });
  }

  const supabase = await createServiceRoleClient();

  const { data: athlete, error: fetchError } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  if (fetchError) return internalServerError(fetchError, "admin-athlete-delete:fetch");
  if (!athlete) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });

  const [contractsRes, agentsRes] = await Promise.all([
    supabase
      .from("contracts")
      .select("contract_id", { count: "exact", head: true })
      .eq("athlete_id", athleteId),
    supabase
      .from("athlete_agents")
      .select("user_id", { count: "exact", head: true })
      .eq("athlete_id", athleteId),
  ]);

  const { error: deleteError } = await supabase
    .from("athletes")
    .delete()
    .eq("athlete_id", athleteId);

  if (deleteError) return internalServerError(deleteError, "admin-athlete-delete:delete");

  const displayName = [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim();

  return NextResponse.json({
    success: true,
    athlete_id: athleteId,
    name: displayName || athleteId,
    contracts_removed: contractsRes.count ?? 0,
    agent_links_removed: agentsRes.count ?? 0,
  });
}
