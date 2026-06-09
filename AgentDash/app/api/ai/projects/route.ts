import { requireProfile } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { enforceContentLengthLimit } from "@/lib/api/request-limits";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    instructions: z.string().trim().max(8000).optional(),
    memory_notes: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
  })
  .strict();

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { data: projects, error } = await supabase
    .from("ai_projects")
    .select("project_id, name, instructions, memory_notes, updated_at, created_at")
    .eq("owner_user_id", profile.user_id)
    .order("updated_at", { ascending: false });

  if (error) {
    return internalServerError(error, "ai-projects:get");
  }

  return NextResponse.json(projects ?? []);
}

export async function POST(req: Request) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireProfile();
  const supabase = await createServerClient();
  const parsedBody = createProjectSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
  }
  const body = parsedBody.data;

  const name = body.name || "General";
  const instructions = body.instructions ?? "";
  const memory_notes = body.memory_notes ?? [];

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
    return internalServerError(projectError ?? new Error("Missing project row"), "ai-projects:post:create-project");
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
    return internalServerError(
      convoError ?? new Error("Missing conversation row"),
      "ai-projects:post:create-conversation"
    );
  }

  return NextResponse.json({
    ...project,
    conversation_id: conversation.conversation_id,
  });
}
