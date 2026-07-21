import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildOutreachAnalytics } from "@/lib/crm/outreach-analytics";
import { getActiveSequence } from "@/lib/crm/outreach-events-server";
import type { Profile } from "@/lib/supabase/types";

export async function GET() {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();

  try {
    const analytics = await fetchOutreachAnalytics(supabase, profile);
    return NextResponse.json({ analytics });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load outreach analytics" },
      { status: 500 }
    );
  }
}

async function fetchOutreachAnalytics(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile
) {
  const teamScope = profile.role === "admin" || profile.role === "sales";

  let eventsQuery = supabase
    .from("crm_outreach_events")
    .select(
      `
      id,
      pipeline_card_id,
      contact_id,
      user_id,
      event_type,
      channel,
      sequence_step_id,
      variant_id,
      product_category,
      occurred_at,
      outcome,
      recipient_timezone,
      recipient_local_hour,
      recipient_local_dow,
      outreach_variants:variant_id ( variant_label ),
      outreach_sequence_steps:sequence_step_id ( short_code, action_label, step_order )
    `
    )
    .order("occurred_at", { ascending: false })
    .limit(5000);

  if (!teamScope) {
    eventsQuery = eventsQuery.eq("user_id", profile.user_id);
  }

  const { data: events, error } = await eventsQuery;
  if (error) throw new Error(error.message);

  const active = await getActiveSequence(supabase);
  let stateRows: Array<{ step_id: string; touch_status: string; response_status: string }> = [];

  if (active) {
    let cardsQuery = supabase
      .from("crm_companies_pipeline")
      .select("id")
      .eq("archived", false)
      .not("sequence_id", "is", null);
    if (!teamScope) cardsQuery = cardsQuery.eq("created_by_user_id", profile.user_id);
    const { data: cards } = await cardsQuery;
    const cardIds = (cards ?? []).map((c) => c.id as string);
    if (cardIds.length > 0) {
      const { data: states } = await supabase
        .from("crm_card_sequence_state")
        .select("step_id, touch_status, response_status")
        .in("card_id", cardIds);
      stateRows = (states ?? []) as typeof stateRows;
    }
  }

  const rows = (events ?? []).map((e) => {
    const variant = e.outreach_variants as { variant_label?: string } | null;
    const step = e.outreach_sequence_steps as {
      short_code?: string;
      action_label?: string;
      step_order?: number;
    } | null;
    return {
      id: e.id as string,
      pipeline_card_id: e.pipeline_card_id as string | null,
      contact_id: e.contact_id as string | null,
      user_id: e.user_id as string,
      event_type: e.event_type as "touch" | "response",
      channel: e.channel as string,
      sequence_step_id: e.sequence_step_id as string | null,
      variant_id: e.variant_id as string | null,
      product_category: e.product_category as string | null,
      occurred_at: e.occurred_at as string,
      outcome: e.outcome as string | null,
      recipient_timezone: e.recipient_timezone as string | null,
      recipient_local_hour: e.recipient_local_hour as number | null,
      recipient_local_dow: e.recipient_local_dow as number | null,
      variant_label: variant?.variant_label ?? null,
      step_short_code: step?.short_code ?? null,
      step_action_label: step?.action_label ?? null,
      step_order: step?.step_order ?? null,
    };
  });

  return buildOutreachAnalytics(rows, {
    scope: teamScope ? "team" : "mine",
    stepDefs: active?.steps.map((s) => ({
      id: s.id,
      short_code: s.short_code,
      action_label: s.action_label,
      step_order: s.step_order,
    })),
    stateRows,
  });
}
