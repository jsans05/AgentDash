import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { accolade } = await req.json();

  // Check access
  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", params.id)
    .single();

  if (!athlete) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canEdit = profile.role === "admin" || (profile.role === "agent" && athlete.current_agent_id === profile.user_id);
  if (!canEdit) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: current } = await supabase
    .from("athletes")
    .select("accolades")
    .eq("athlete_id", params.id)
    .single();

  const updated = [...(current?.accolades || []), accolade];

  const { error } = await supabase
    .from("athletes")
    .update({ accolades: updated })
    .eq("athlete_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { index } = await req.json();

  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", params.id)
    .single();

  if (!athlete) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canEdit = profile.role === "admin" || (profile.role === "agent" && athlete.current_agent_id === profile.user_id);
  if (!canEdit) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: current } = await supabase
    .from("athletes")
    .select("accolades")
    .eq("athlete_id", params.id)
    .single();

  const updated = (current?.accolades || []).filter((_: any, i: number) => i !== index);

  const { error } = await supabase
    .from("athletes")
    .update({ accolades: updated })
    .eq("athlete_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
