import { requireProfile } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { data: projects, error } = await supabase
    .from("ai_projects")
    .select("project_id, name, instructions, memory_notes, updated_at, created_at")
    .eq("owner_user_id", profile.user_id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(projects ?? []);
}

export async function POST(req: Request) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));

  const name = String(body?.name ?? "").trim() || "General";
  const instructions = String(body?.instructions ?? "").trim();
  const memory_notes = Array.isArray(body?.memory_notes) ? body.memory_notes : [];

  const { data: project, error: projectError } = await supabase
    .from("ai_projects")
    .insert({
      owner_user_id: profile.user_id,
      name,
      instructions,
      memory_notes,
    })
    .select("project_id, name, instructions, memory_notes, updated_at, created_at")
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: projectError?.message ?? "Failed to create project" }, { status: 500 });
  }

  const { data: conversation, error: convoError } = await supabase
    .from("ai_conversations")
    .insert({
      project_id: project.project_id,
      owner_user_id: profile.user_id,
      title: null,
    })
    .select("conversation_id")
    .single();

  if (convoError || !conversation) {
    return NextResponse.json({ error: convoError?.message ?? "Failed to create conversation" }, { status: 500 });
  }

  return NextResponse.json({
    ...project,
    conversation_id: conversation.conversation_id,
  });
}
