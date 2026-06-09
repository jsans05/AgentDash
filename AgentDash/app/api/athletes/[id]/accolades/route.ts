import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { internalErrorResponse, logServerError } from "@/lib/api-errors";
import { NextResponse } from "next/server";
import { z } from "zod";

const createAccoladeSchema = z
  .object({
    accolade: z.string().trim().min(1).max(300),
  })
  .strict();

const deleteAccoladeSchema = z
  .object({
    index: z.number().int().min(0),
  })
  .strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const parsedBody = createAccoladeSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
  }
  const { accolade } = parsedBody.data;
  const { id: athleteId } = await params;

  // Check access
  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canEdit = profile.role === "admin" || (profile.role === "agent" && athlete.current_agent_id === profile.user_id);
  if (!canEdit) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: current } = await supabase
    .from("athletes")
    .select("accolades")
    .eq("athlete_id", athleteId)
    .single();

  const updated = [...(current?.accolades || []), accolade];

  const { error } = await supabase
    .from("athletes")
    .update({ accolades: updated })
    .eq("athlete_id", athleteId);

  if (error) {
    logServerError("athlete-accolades:post:update", error);
    return internalErrorResponse();
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const parsedBody = deleteAccoladeSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
  }
  const { index } = parsedBody.data;
  const { id: athleteId } = await params;

  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const canEdit = profile.role === "admin" || (profile.role === "agent" && athlete.current_agent_id === profile.user_id);
  if (!canEdit) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: current } = await supabase
    .from("athletes")
    .select("accolades")
    .eq("athlete_id", athleteId)
    .single();

  const updated = (current?.accolades || []).filter((_: any, i: number) => i !== index);

  const { error } = await supabase
    .from("athletes")
    .update({ accolades: updated })
    .eq("athlete_id", athleteId);

  if (error) {
    logServerError("athlete-accolades:delete:update", error);
    return internalErrorResponse();
  }
  return NextResponse.json({ success: true });
}
