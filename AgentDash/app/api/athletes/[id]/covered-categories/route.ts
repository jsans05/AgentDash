import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
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

  const { data, error } = await supabase
    .from("athlete_covered_categories")
    .select("taxonomy_id")
    .eq("athlete_id", athleteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const taxonomy_ids = (data ?? []).map((r: { taxonomy_id: string }) => r.taxonomy_id);
  return NextResponse.json({ taxonomy_ids });
}

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

  let body: { taxonomy_ids?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const taxonomy_ids = Array.isArray(body.taxonomy_ids) ? body.taxonomy_ids : [];

  const { error: deleteErr } = await supabase
    .from("athlete_covered_categories")
    .delete()
    .eq("athlete_id", athleteId);

  if (deleteErr) {
    const message = deleteErr.message || String(deleteErr);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (taxonomy_ids.length === 0) {
    return NextResponse.json({ taxonomy_ids: [] });
  }

  const rows = taxonomy_ids
    .filter((id: unknown) => typeof id === "string" && id.length > 0)
    .map((taxonomy_id: string) => ({ athlete_id: athleteId, taxonomy_id }));

  const { error: insertErr } = await supabase
    .from("athlete_covered_categories")
    .insert(rows);

  if (insertErr) {
    const message = insertErr.message || String(insertErr);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ taxonomy_ids: rows.map((r) => r.taxonomy_id) });
}
