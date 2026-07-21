import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import { VARIANT_LABELS } from "@/lib/crm/outreach-variants";

const CHANNELS = new Set([
  "cold_email",
  "support_email",
  "instagram_dm",
  "instagram_engage",
  "linkedin",
  "cold_call",
]);

export async function GET(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  const includeArchived = url.searchParams.get("include_archived") === "1";

  let query = supabase
    .from("outreach_variants")
    .select("*")
    .eq("created_by_user_id", profile.user_id)
    .order("channel", { ascending: true })
    .order("variant_label", { ascending: true });

  if (!includeArchived) query = query.eq("archived", false);
  if (channel && CHANNELS.has(channel)) query = query.eq("channel", channel);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach send counts
  const ids = (data ?? []).map((v) => v.id as string);
  const sendCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: events } = await supabase
      .from("crm_outreach_events")
      .select("variant_id")
      .eq("user_id", profile.user_id)
      .eq("event_type", "touch")
      .in("variant_id", ids);
    for (const row of events ?? []) {
      const id = row.variant_id as string;
      if (!id) continue;
      sendCounts[id] = (sendCounts[id] ?? 0) + 1;
    }
  }

  const variants = (data ?? []).map((v) => ({
    ...v,
    send_count: sendCounts[v.id as string] ?? 0,
  }));

  return NextResponse.json({ variants });
}

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));

  const channel = String(body.channel ?? "").trim();
  if (!CHANNELS.has(channel)) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  }

  const bodyText = String(body.body ?? "").trim();
  if (!bodyText) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  let variantLabel = String(body.variant_label ?? "A").trim().toUpperCase();
  if (!(VARIANT_LABELS as readonly string[]).includes(variantLabel)) {
    variantLabel = "A";
  }

  // Auto-pick next letter if not provided explicitly and A already exists for channel
  if (!body.variant_label) {
    const { data: existing } = await supabase
      .from("outreach_variants")
      .select("variant_label")
      .eq("created_by_user_id", profile.user_id)
      .eq("channel", channel)
      .eq("archived", false);
    const used = new Set((existing ?? []).map((r) => String(r.variant_label)));
    for (const label of VARIANT_LABELS) {
      if (!used.has(label)) {
        variantLabel = label;
        break;
      }
    }
  }

  const { data, error } = await supabase
    .from("outreach_variants")
    .insert({
      created_by_user_id: profile.user_id,
      variant_label: variantLabel,
      name: body.name != null ? String(body.name).trim() || null : null,
      channel,
      sequence_step_id:
        body.sequence_step_id != null && String(body.sequence_step_id).trim()
          ? String(body.sequence_step_id).trim()
          : null,
      subject: body.subject != null ? String(body.subject).trim() || null : null,
      body: bodyText,
      is_active: body.is_active !== false,
      archived: false,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, variant: data });
}
