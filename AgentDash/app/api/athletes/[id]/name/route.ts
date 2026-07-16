import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";

function normalizeAliases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: athleteId } = await params;
  const profile = await requireNonAccounting();
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

  let body: {
    first_name?: unknown;
    last_name?: unknown;
    name_aliases?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const first_name =
    typeof body.first_name === "string" ? body.first_name.trim() : "";
  const last_name =
    typeof body.last_name === "string" ? body.last_name.trim() : "";
  if (!first_name) {
    return NextResponse.json({ error: "first_name is required" }, { status: 400 });
  }

  const name_aliases = normalizeAliases(body.name_aliases);

  const { data, error } = await supabase
    .from("athletes")
    .update({
      first_name,
      last_name,
      name_aliases,
      updated_at: new Date().toISOString(),
    })
    .eq("athlete_id", athleteId)
    .select("first_name, last_name, name_aliases")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
