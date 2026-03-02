import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  const profile = await requireProfile();
  const supabase = await createServiceRoleClient();

  // Check if user can edit this athlete
  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", params.id)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  const canEdit =
    profile.role === "admin" ||
    (profile.role === "agent" && athlete.current_agent_id === profile.user_id);

  if (!canEdit) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { creatoriq_publisher_id } = await req.json();

  const { error } = await supabase
    .from("athletes")
    .update({ creatoriq_publisher_id: creatoriq_publisher_id || null })
    .eq("athlete_id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
