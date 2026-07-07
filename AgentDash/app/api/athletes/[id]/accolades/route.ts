import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { internalErrorResponse, logServerError } from "@/lib/api-errors";
import { ensureAthleteAccess } from "@/lib/features/contracts/service";
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
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const parsedBody = createAccoladeSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
  }
  const { accolade } = parsedBody.data;
  const { id: athleteId } = await params;

  const access = await ensureAthleteAccess(supabase, profile, athleteId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

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
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const parsedBody = deleteAccoladeSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsedBody.error.flatten() }, { status: 400 });
  }
  const { index } = parsedBody.data;
  const { id: athleteId } = await params;

  const access = await ensureAthleteAccess(supabase, profile, athleteId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: current } = await supabase
    .from("athletes")
    .select("accolades")
    .eq("athlete_id", athleteId)
    .single();

  const updated = (current?.accolades || []).filter((_: unknown, i: number) => i !== index);

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
