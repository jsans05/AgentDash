import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { normalizeAthleteGender } from "@/lib/athletes/gender";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: athleteId } = await params;
  const profile = await requireProfile();
  const supabase = await createServerClient();

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

  let body: { gender?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gender =
    body.gender == null || String(body.gender).trim() === ""
      ? null
      : normalizeAthleteGender(body.gender);

  if (body.gender != null && String(body.gender).trim() !== "" && !gender) {
    return NextResponse.json(
      { error: "gender must be female, male, or non_binary" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("athletes")
    .update({ gender })
    .eq("athlete_id", athleteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ gender });
}
