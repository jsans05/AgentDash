import { requireRole } from "@/lib/auth";
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

    if (audienceError) {
      return NextResponse.json({ error: audienceError.message }, { status: 500 });
    }

    const { error: socialError } = await supabase
      .from("athlete_social_data")
      .delete()
      .neq("id", fakeId);

    if (socialError) {
      return NextResponse.json({ error: socialError.message }, { status: 500 });
    }

    const { error: contractsError } = await supabase
      .from("contracts")
      .delete()
      .neq("contract_id", fakeId);

    if (contractsError) {
      return NextResponse.json({ error: contractsError.message }, { status: 500 });
    }

    const { error: historyError } = await supabase
      .from("athlete_agent_history")
      .delete()
      .neq("id", fakeId);

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    const { data: deletedAthletes, error: athletesError } = await supabase
      .from("athletes")
      .delete()
      .neq("athlete_id", fakeId)
      .select("athlete_id");

    if (athletesError) {
      return NextResponse.json({ error: athletesError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: deletedAthletes?.length ?? 0 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
