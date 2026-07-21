import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  ensureCardSequenceStarted,
  getActiveSequence,
  insertOutreachEvent,
  loadCardSequenceState,
  pickVariantForChannel,
  resolveTimezoneForCard,
  syncCardCadenceFromSequence,
} from "@/lib/crm/outreach-events-server";
import {
  cycleResponseStatus,
  cycleTouchStatus,
  isStepBlocked,
  type OutreachChannel,
  type ResponseStatus,
  type TouchStatus,
} from "@/lib/crm/outreach-sequence";
import { clearCadenceOnResponded } from "@/lib/crm/pipeline-cadence";
import { normalizePipelineStage, pipelineStageToFunnel } from "@/lib/crm/stage-map";

export async function GET(req: Request) {
  await requireNonAccounting();
  const supabase = await createServerClient();
  const url = new URL(req.url);
  const cardId = url.searchParams.get("card_id");

  const active = await getActiveSequence(supabase);
  if (!active) {
    return NextResponse.json({ sequence: null, steps: [], states: [] });
  }

  if (!cardId) {
    return NextResponse.json({
      sequence: active.sequence,
      steps: active.steps,
      states: [],
    });
  }

  const states = await loadCardSequenceState(supabase, cardId);
  const { data: card } = await supabase
    .from("crm_companies_pipeline")
    .select("id, sequence_id, sequence_started_at, responded_at, timezone, pipeline_stage")
    .eq("id", cardId)
    .maybeSingle();

  return NextResponse.json({
    sequence: active.sequence,
    steps: active.steps,
    states,
    card: card ?? null,
  });
}

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "").trim();

  if (action === "start") {
    const cardId = String(body.card_id ?? "").trim();
    if (!cardId) return NextResponse.json({ error: "card_id required" }, { status: 400 });
    const started = await ensureCardSequenceStarted(supabase, cardId, profile.user_id);
    const states = await loadCardSequenceState(supabase, cardId);
    await syncCardCadenceFromSequence(supabase, cardId, started.steps, states, {
      sequence_id: started.sequence_id,
      sequence_started_at: started.sequence_started_at,
      responded_at: null,
    });
    return NextResponse.json({
      ok: true,
      sequence_id: started.sequence_id,
      sequence_started_at: started.sequence_started_at,
      steps: started.steps,
      states,
    });
  }

  if (action === "cycle_touch" || action === "set_touch") {
    const cardId = String(body.card_id ?? "").trim();
    const stepId = String(body.step_id ?? "").trim();
    if (!cardId || !stepId) {
      return NextResponse.json({ error: "card_id and step_id required" }, { status: 400 });
    }

    const started = await ensureCardSequenceStarted(supabase, cardId, profile.user_id);
    const step = started.steps.find((s) => s.id === stepId);
    if (!step) return NextResponse.json({ error: "Unknown step" }, { status: 400 });

    let states = await loadCardSequenceState(supabase, cardId);
    const blocked = isStepBlocked(step, started.steps, states);
    if (blocked.blocked && action === "cycle_touch") {
      return NextResponse.json({ error: blocked.reason ?? "Step blocked" }, { status: 400 });
    }

    const current = states.find((s) => s.step_id === stepId);
    const currentTouch = (current?.touch_status ?? "pending") as TouchStatus;
    let nextTouch: TouchStatus =
      action === "set_touch" && body.touch_status
        ? (String(body.touch_status) as TouchStatus)
        : cycleTouchStatus(currentTouch);

    if (!["pending", "done", "skipped"].includes(nextTouch)) {
      return NextResponse.json({ error: "Invalid touch_status" }, { status: 400 });
    }

    let variantId =
      body.variant_id != null && String(body.variant_id).trim()
        ? String(body.variant_id).trim()
        : current?.variant_id ?? null;

    if (nextTouch === "done" && !variantId) {
      const picked = await pickVariantForChannel(
        supabase,
        profile.user_id,
        step.channel as OutreachChannel,
        step.id
      );
      variantId = picked?.id ?? null;
    }

    const outcome =
      body.outcome != null ? String(body.outcome) : nextTouch === "skipped" ? "skipped" : "sent";
    const notes = body.notes != null ? String(body.notes) : current?.notes ?? null;
    const doneAt = nextTouch === "done" || nextTouch === "skipped" ? new Date().toISOString() : null;

    const upsertPayload = {
      card_id: cardId,
      step_id: stepId,
      touch_status: nextTouch,
      response_status: current?.response_status ?? "awaiting",
      done_at: doneAt,
      variant_id: variantId,
      outcome: nextTouch === "pending" ? null : outcome,
      notes,
    };

    const { data: stateRow, error: stateErr } = await supabase
      .from("crm_card_sequence_state")
      .upsert(upsertPayload, { onConflict: "card_id,step_id" })
      .select("*")
      .single();
    if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 });

    // Log event when marking done or skipped
    let event = null;
    if (nextTouch === "done" || nextTouch === "skipped") {
      const { data: cardRow } = await supabase
        .from("crm_companies_pipeline")
        .select("id, timezone, companies(product_category)")
        .eq("id", cardId)
        .single();
      const companies = cardRow?.companies as { product_category?: string | null } | null;
      const tz = await resolveTimezoneForCard(supabase, { cardId });
      event = await insertOutreachEvent(supabase, {
        userId: profile.user_id,
        pipelineCardId: cardId,
        eventType: "touch",
        channel: step.channel as OutreachChannel,
        sequenceStepId: step.id,
        variantId,
        productCategory: companies?.product_category ?? null,
        occurredAt: doneAt,
        outcome: nextTouch === "skipped" ? "skipped" : outcome,
        notes,
        timezone: tz ?? (cardRow?.timezone as string | null),
      });

      // Set outreach_at on first done touch if unset
      const { data: fullCard } = await supabase
        .from("crm_companies_pipeline")
        .select("outreach_at, sequence_id, sequence_started_at, responded_at")
        .eq("id", cardId)
        .single();
      if (fullCard && !fullCard.outreach_at && nextTouch === "done") {
        await supabase
          .from("crm_companies_pipeline")
          .update({ outreach_at: doneAt, last_touch_at: doneAt })
          .eq("id", cardId);
      } else {
        await supabase
          .from("crm_companies_pipeline")
          .update({ last_touch_at: doneAt })
          .eq("id", cardId);
      }
    }

    states = await loadCardSequenceState(supabase, cardId);
    const { data: cardAfter } = await supabase
      .from("crm_companies_pipeline")
      .select("sequence_id, sequence_started_at, responded_at")
      .eq("id", cardId)
      .single();
    if (cardAfter) {
      await syncCardCadenceFromSequence(supabase, cardId, started.steps, states, {
        sequence_id: cardAfter.sequence_id,
        sequence_started_at: cardAfter.sequence_started_at,
        responded_at: cardAfter.responded_at,
      });
    }

    return NextResponse.json({
      ok: true,
      state: stateRow,
      event,
      touch_status: nextTouch,
      variant_id: variantId,
    });
  }

  if (action === "cycle_response" || action === "set_response") {
    const cardId = String(body.card_id ?? "").trim();
    const stepId = String(body.step_id ?? "").trim();
    if (!cardId || !stepId) {
      return NextResponse.json({ error: "card_id and step_id required" }, { status: 400 });
    }

    const started = await ensureCardSequenceStarted(supabase, cardId, profile.user_id);
    const step = started.steps.find((s) => s.id === stepId);
    if (!step) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
    if (!step.expects_response) {
      return NextResponse.json({ error: "This step has no response cell" }, { status: 400 });
    }

    let states = await loadCardSequenceState(supabase, cardId);
    const current = states.find((s) => s.step_id === stepId);
    const currentResp = (current?.response_status ?? "awaiting") as ResponseStatus;
    const nextResp: ResponseStatus =
      action === "set_response" && body.response_status
        ? (String(body.response_status) as ResponseStatus)
        : cycleResponseStatus(currentResp);

    if (!["awaiting", "responded", "no_response"].includes(nextResp)) {
      return NextResponse.json({ error: "Invalid response_status" }, { status: 400 });
    }

    const sentiment =
      body.outcome != null
        ? String(body.outcome)
        : nextResp === "responded"
          ? "positive"
          : nextResp === "no_response"
            ? "none"
            : null;

    const { data: stateRow, error: stateErr } = await supabase
      .from("crm_card_sequence_state")
      .upsert(
        {
          card_id: cardId,
          step_id: stepId,
          touch_status: current?.touch_status ?? "pending",
          response_status: nextResp,
          done_at: current?.done_at ?? null,
          variant_id: current?.variant_id ?? null,
          outcome: current?.outcome ?? null,
          notes: current?.notes ?? null,
        },
        { onConflict: "card_id,step_id" }
      )
      .select("*")
      .single();
    if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 });

    let event = null;
    let movedToNegotiating = false;
    if (nextResp === "responded") {
      const tz = await resolveTimezoneForCard(supabase, { cardId });
      const { data: cardRow } = await supabase
        .from("crm_companies_pipeline")
        .select("companies(product_category)")
        .eq("id", cardId)
        .single();
      const companies = cardRow?.companies as { product_category?: string | null } | null;

      event = await insertOutreachEvent(supabase, {
        userId: profile.user_id,
        pipelineCardId: cardId,
        eventType: "response",
        channel: step.channel as OutreachChannel,
        sequenceStepId: step.id,
        variantId: current?.variant_id ?? null,
        productCategory: companies?.product_category ?? null,
        outcome: sentiment,
        notes: body.notes != null ? String(body.notes) : null,
        timezone: tz,
      });

      const cadenceClear = clearCadenceOnResponded();
      const move = body.move_to_negotiating !== false;
      const updates: Record<string, unknown> = { ...cadenceClear };
      if (move) {
        updates.pipeline_stage = "in_progress";
        updates.funnel_stage = pipelineStageToFunnel(normalizePipelineStage("in_progress"));
        movedToNegotiating = true;
      }
      await supabase.from("crm_companies_pipeline").update(updates).eq("id", cardId);
    } else if (nextResp === "awaiting") {
      // Clearing response — don't wipe card responded_at if other steps still responded
      states = await loadCardSequenceState(supabase, cardId);
      const stillResponded = states.some(
        (s) => s.step_id !== stepId && s.response_status === "responded"
      );
      if (!stillResponded) {
        await supabase
          .from("crm_companies_pipeline")
          .update({ responded_at: null })
          .eq("id", cardId);
      }
    }

    states = await loadCardSequenceState(supabase, cardId);
    const { data: cardAfter } = await supabase
      .from("crm_companies_pipeline")
      .select("sequence_id, sequence_started_at, responded_at")
      .eq("id", cardId)
      .single();
    if (cardAfter) {
      await syncCardCadenceFromSequence(supabase, cardId, started.steps, states, {
        sequence_id: cardAfter.sequence_id,
        sequence_started_at: cardAfter.sequence_started_at,
        responded_at: cardAfter.responded_at,
      });
    }

    return NextResponse.json({
      ok: true,
      state: stateRow,
      event,
      response_status: nextResp,
      moved_to_negotiating: movedToNegotiating,
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
