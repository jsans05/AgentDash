import { requireRole } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** POST /api/admin/athletes/clear – delete all athletes and related data (admin only). */
export async function POST() {
  await requireRole("admin");

  const supabase = await createServiceRoleClient();

  try {
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const { error: audienceError } = await supabase
      .from("athlete_audience_data")
      .delete()
      .neq("id", fakeId);

    if (audienceError) return internalServerError(audienceError, "admin-athletes-clear:audience");

    const { error: socialError } = await supabase
      .from("athlete_social_data")
      .delete()
      .neq("id", fakeId);

    if (socialError) return internalServerError(socialError, "admin-athletes-clear:social");

    const { error: contractsError } = await supabase
      .from("contracts")
      .delete()
      .neq("contract_id", fakeId);

    if (contractsError) return internalServerError(contractsError, "admin-athletes-clear:contracts");

    const { error: historyError } = await supabase
      .from("athlete_agent_history")
      .delete()
      .neq("id", fakeId);

    if (historyError) return internalServerError(historyError, "admin-athletes-clear:history");

    const { data: deletedAthletes, error: athletesError } = await supabase
      .from("athletes")
      .delete()
      .neq("athlete_id", fakeId)
      .select("athlete_id");

    if (athletesError) return internalServerError(athletesError, "admin-athletes-clear:athletes");

    return NextResponse.json({ success: true, deleted: deletedAthletes?.length ?? 0 });
  } catch (error: unknown) {
    return internalServerError(error, "admin-athletes-clear:catch");
  }
}
