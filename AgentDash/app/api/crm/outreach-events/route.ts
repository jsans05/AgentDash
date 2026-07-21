import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  insertOutreachEvent,
  resolveTimezoneForCard,
} from "@/lib/crm/outreach-events-server";
import { mapLegacyChannel, type OutreachChannel } from "@/lib/crm/outreach-sequence";

export async function GET(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const url = new URL(req.url);
  const cardId = url.searchParams.get("card_id");
  const contactId = url.searchParams.get("contact_id");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  let query = supabase
    .from("crm_outreach_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (cardId) query = query.eq("pipeline_card_id", cardId);
  if (contactId) query = query.eq("contact_id", contactId);
  if (profile.role !== "admin" && profile.role !== "sales") {
    query = query.eq("user_id", profile.user_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));

  const channelRaw = String(body.channel ?? body.outreach_channel ?? "other").trim();
  const channel = mapLegacyChannel(channelRaw) as OutreachChannel;
  const eventType = (String(body.event_type ?? "touch").trim() === "response"
    ? "response"
    : "touch") as "touch" | "response";

  const pipelineCardId =
    body.pipeline_card_id != null && String(body.pipeline_card_id).trim()
      ? String(body.pipeline_card_id).trim()
      : null;
  const contactId =
    body.contact_id != null && String(body.contact_id).trim()
      ? String(body.contact_id).trim()
      : null;

  if (!pipelineCardId && !contactId) {
    return NextResponse.json(
      { error: "pipeline_card_id or contact_id required" },
      { status: 400 }
    );
  }

  const tz =
    body.timezone != null && String(body.timezone).trim()
      ? String(body.timezone).trim()
      : await resolveTimezoneForCard(supabase, { cardId: pipelineCardId, contactId });

  let productCategory: string | null = null;
  if (pipelineCardId) {
    const { data: card } = await supabase
      .from("crm_companies_pipeline")
      .select("companies(product_category)")
      .eq("id", pipelineCardId)
      .maybeSingle();
    const companies = card?.companies as { product_category?: string | null } | null;
    productCategory = companies?.product_category ?? null;
  }

  try {
    const event = await insertOutreachEvent(supabase, {
      userId: profile.user_id,
      pipelineCardId,
      contactId,
      eventType,
      channel,
      sequenceStepId: body.sequence_step_id ?? null,
      variantId: body.variant_id ?? null,
      productCategory,
      occurredAt: body.occurred_at ?? body.outreach_at ?? null,
      outcome: body.outcome ?? null,
      respondingToEventId: body.responding_to_event_id ?? null,
      notes: body.notes ?? body.outreach_notes ?? null,
      timezone: tz,
    });
    return NextResponse.json({ ok: true, event });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to insert event" },
      { status: 500 }
    );
  }
}
