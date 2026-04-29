import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
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

  let body: { notes?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const notes =
    typeof body.notes === "string" ? (body.notes.trim().length > 0 ? body.notes.trim() : null) : null;

  const { error } = await supabase
    .from("athletes")
    .update({ notes })
    .eq("athlete_id", athleteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: notes ?? "" });
}
