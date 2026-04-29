import { requireProfile } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (body?.name != null) updates.name = String(body.name).trim() || "Untitled Project";
  if (body?.instructions != null) updates.instructions = String(body.instructions ?? "").trim();
  if (body?.memory_notes != null) updates.memory_notes = Array.isArray(body.memory_notes) ? body.memory_notes : [];

  const { data, error } = await supabase
    .from("ai_projects")
    .update(updates)
    .eq("project_id", id)
    .eq("owner_user_id", profile.user_id)
    .select("project_id, name, instructions, memory_notes, updated_at, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await ctx.params;

  const { error } = await supabase
    .from("ai_projects")
    .delete()
    .eq("project_id", id)
    .eq("owner_user_id", profile.user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
