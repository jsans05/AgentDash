import { requireProfile } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

async function getLatestConversation(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
  ownerId: string
) {
  const { data: convo, error } = await supabase
    .from("ai_conversations")
    .select("conversation_id, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("owner_user_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return convo;
}

export async function GET(_req: Request, ctx: Ctx) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await ctx.params;

  let convo = await getLatestConversation(supabase, id, profile.user_id);
  if (!convo) {
    const { data: created, error: createError } = await supabase
      .from("ai_conversations")
      .insert({
        project_id: id,
        owner_user_id: profile.user_id,
        title: null,
      })
      .select("conversation_id, created_at, updated_at")
      .single();
    if (createError || !created) {
      return NextResponse.json({ error: createError?.message ?? "Failed to create conversation" }, { status: 500 });
    }
    convo = created;
  }

  const { data: messages, error: msgError } = await supabase
    .from("ai_messages")
    .select("message_id, role, content, created_at")
    .eq("conversation_id", convo.conversation_id)
    .eq("owner_user_id", profile.user_id)
    .order("created_at", { ascending: true });

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  return NextResponse.json({
    conversation_id: convo.conversation_id,
    messages: (messages ?? []).map((m) => ({
      id: m.message_id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const title = body?.title ? String(body.title).trim() : null;
  const { data: convo, error } = await supabase
    .from("ai_conversations")
    .insert({
      project_id: id,
      owner_user_id: profile.user_id,
      title,
    })
    .select("conversation_id")
    .single();

  if (error || !convo) {
    return NextResponse.json({ error: error?.message ?? "Failed to create conversation" }, { status: 500 });
  }

  return NextResponse.json({
    conversation_id: convo.conversation_id,
    messages: [],
  });
}
