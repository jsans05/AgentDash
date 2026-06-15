import { isPendingTurnState, parseMessageMetadata } from "@/lib/ai/user-question";
import { internalServerError, unauthorizedResponse } from "@/lib/api/http-errors";
import { getCurrentProfile } from "@/lib/auth";
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
    .select("conversation_id, created_at, updated_at, pending_turn, flow_mode")
    .eq("project_id", projectId)
    .eq("owner_user_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return convo;
}

export async function GET(req: Request, ctx: Ctx) {
  const profile = await getCurrentProfile();
  if (!profile) return unauthorizedResponse();
  const supabase = await createServerClient();
  const { id } = await ctx.params;
  const requestedConversationId = new URL(req.url).searchParams.get("conversation_id")?.trim() ?? "";

  let convo: Awaited<ReturnType<typeof getLatestConversation>> = null;
  if (requestedConversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("conversation_id, created_at, updated_at, pending_turn, flow_mode")
      .eq("conversation_id", requestedConversationId)
      .eq("project_id", id)
      .eq("owner_user_id", profile.user_id)
      .maybeSingle();
    if (error) {
      return internalServerError(error, "ai-conversation:get:by-id");
    }
    convo = data;
    if (!convo) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  } else {
    try {
      convo = await getLatestConversation(supabase, id, profile.user_id);
    } catch (error) {
      return internalServerError(error, "ai-conversation:get:latest");
    }
  }

  if (!convo) {
    const { data: created, error: createError } = await supabase
      .from("ai_conversations")
      .insert({
        project_id: id,
        owner_user_id: profile.user_id,
        title: null,
      })
      .select("conversation_id, created_at, updated_at, pending_turn, flow_mode")
      .single();
    if (createError || !created) {
      return NextResponse.json({ error: createError?.message ?? "Failed to create conversation" }, { status: 500 });
    }
    convo = created;
  }

  const { data: messages, error: msgError } = await supabase
    .from("ai_messages")
    .select("message_id, role, content, metadata, created_at")
    .eq("conversation_id", convo.conversation_id)
    .eq("owner_user_id", profile.user_id)
    .order("created_at", { ascending: true });

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  const pendingTurn = isPendingTurnState(convo.pending_turn) ? convo.pending_turn : null;

  return NextResponse.json({
    conversation_id: convo.conversation_id,
    flow_mode: (convo as { flow_mode?: string | null }).flow_mode ?? null,
    pending_interaction: pendingTurn
      ? {
          tool_call_id: pendingTurn.tool_call_id,
          prompt: pendingTurn.prompt,
        }
      : null,
    messages: (() => {
      const seen = new Set<string>();
      return (messages ?? [])
        .filter((m) => {
          const id = String(m.message_id);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((m) => {
          const meta = parseMessageMetadata(m.metadata);
          let interactionStatus = meta?.interaction_status ?? null;
          if (interactionStatus === "pending") {
            const toolId = meta?.tool_call_id ?? null;
            if (!pendingTurn || pendingTurn.tool_call_id !== toolId) {
              interactionStatus = "expired";
            }
          }
          return {
            id: m.message_id,
            role: m.role,
            content: m.content,
            createdAt: m.created_at,
            interaction: meta?.interaction ?? null,
            interactionStatus,
            toolCallId: meta?.tool_call_id ?? null,
          };
        });
    })(),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const profile = await getCurrentProfile();
  if (!profile) return unauthorizedResponse();
  const supabase = await createServerClient();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const title = body?.title ? String(body.title).trim() : null;

  // Abandon any in-progress interest pickers on older threads in this project.
  await supabase
    .from("ai_conversations")
    .update({ pending_turn: null })
    .eq("project_id", id)
    .eq("owner_user_id", profile.user_id)
    .not("pending_turn", "is", null);

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
