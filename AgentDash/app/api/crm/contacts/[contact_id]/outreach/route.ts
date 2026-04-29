import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  await requireProfile();
  const supabase = await createServerClient();
  const { contact_id } = await params;

  const { data, error } = await supabase
    .from("crm_outreach_logs")
    .select(
      `
        id,
        contact_id,
        user_id,
        outreach_channel,
        outreach_at,
        outreach_notes,
        athlete_id,
        athletes:athlete_id (athlete_id, first_name, last_name, sport)
      `
    )
    .eq("contact_id", contact_id)
    .order("outreach_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { contact_id } = await params;
  const body = await req.json().catch(() => ({}));

  const outreach_channel =
    body.outreach_channel != null && String(body.outreach_channel).trim()
      ? String(body.outreach_channel).trim()
      : "other";
  const outreach_notes = body.outreach_notes != null ? String(body.outreach_notes) : null;

  const athlete_id = body.athlete_id != null && String(body.athlete_id).trim() ? String(body.athlete_id) : null;

  const outreach_at_raw = body.outreach_at != null ? String(body.outreach_at) : null;
  const outreach_at = outreach_at_raw && outreach_at_raw.trim() ? outreach_at_raw.trim() : null;

  const insertPayload: any = {
    contact_id,
    athlete_id,
    user_id: profile.user_id,
    outreach_channel,
    outreach_notes,
  };
  if (outreach_at) insertPayload.outreach_at = outreach_at;

  const { data, error } = await supabase
    .from("crm_outreach_logs")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, log: data });
}

