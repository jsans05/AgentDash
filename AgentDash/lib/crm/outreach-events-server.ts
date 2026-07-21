import { createServerClient } from "@/lib/supabase/server";
import { computeLocalTimeSnapshot } from "@/lib/crm/outreach-local-time";
import type { OutreachChannel } from "@/lib/crm/outreach-sequence";
import {
  cadenceFieldsFromSequence,
  type CardStepState,
  type SequenceStepDef,
} from "@/lib/crm/outreach-sequence";
import { pickRoundRobinVariant, type OutreachVariant } from "@/lib/crm/outreach-variants";

export type InsertOutreachEventInput = {
  userId: string;
  pipelineCardId?: string | null;
  contactId?: string | null;
  eventType: "touch" | "response";
  channel: OutreachChannel;
  sequenceStepId?: string | null;
  variantId?: string | null;
  productCategory?: string | null;
  occurredAt?: string | null;
  outcome?: string | null;
  respondingToEventId?: string | null;
  notes?: string | null;
  /** Prefer contact timezone over card timezone when both present */
  timezone?: string | null;
};

export async function insertOutreachEvent(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  input: InsertOutreachEventInput
) {
  const occurredAt = input.occurredAt?.trim() || new Date().toISOString();
  const local = computeLocalTimeSnapshot(occurredAt, input.timezone);

  const { data, error } = await supabase
    .from("crm_outreach_events")
    .insert({
      pipeline_card_id: input.pipelineCardId ?? null,
      contact_id: input.contactId ?? null,
      user_id: input.userId,
      event_type: input.eventType,
      channel: input.channel,
      sequence_step_id: input.sequenceStepId ?? null,
      variant_id: input.variantId ?? null,
      product_category: input.productCategory ?? null,
      occurred_at: occurredAt,
      outcome: input.outcome ?? null,
      responding_to_event_id: input.respondingToEventId ?? null,
      notes: input.notes ?? null,
      recipient_timezone: local.recipient_timezone,
      recipient_local_hour: local.recipient_local_hour,
      recipient_local_dow: local.recipient_local_dow,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function resolveTimezoneForCard(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  opts: { cardId?: string | null; contactId?: string | null }
): Promise<string | null> {
  if (opts.contactId) {
    const { data } = await supabase
      .from("crm_contacts")
      .select("timezone")
      .eq("contact_id", opts.contactId)
      .maybeSingle();
    if (data?.timezone) return String(data.timezone);
  }
  if (opts.cardId) {
    const { data } = await supabase
      .from("crm_companies_pipeline")
      .select("timezone")
      .eq("id", opts.cardId)
      .maybeSingle();
    if (data?.timezone) return String(data.timezone);
  }
  return null;
}

export async function getActiveSequence(
  supabase: Awaited<ReturnType<typeof createServerClient>>
): Promise<{ sequence: { id: string; name: string; version: number }; steps: SequenceStepDef[] } | null> {
  const { data: seq } = await supabase
    .from("outreach_sequences")
    .select("id, name, version")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!seq) return null;

  const { data: steps, error } = await supabase
    .from("outreach_sequence_steps")
    .select(
      "id, sequence_id, step_order, day_offset, channel, action_label, short_code, phase, expects_response, is_optional, guidance"
    )
    .eq("sequence_id", seq.id)
    .order("step_order", { ascending: true });

  if (error) throw new Error(error.message);

  return {
    sequence: seq as { id: string; name: string; version: number },
    steps: (steps ?? []) as SequenceStepDef[],
  };
}

export async function ensureCardSequenceStarted(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  cardId: string,
  userId: string
): Promise<{ sequence_id: string; sequence_started_at: string; steps: SequenceStepDef[] }> {
  const { data: card, error } = await supabase
    .from("crm_companies_pipeline")
    .select("id, sequence_id, sequence_started_at, created_by_user_id, outreach_at")
    .eq("id", cardId)
    .single();

  if (error || !card) throw new Error(error?.message ?? "Card not found");
  if (card.created_by_user_id !== userId) {
    // allow sales/admin via RLS; still proceed if readable
  }

  const active = await getActiveSequence(supabase);
  if (!active) throw new Error("No active outreach sequence configured");

  let sequenceId = card.sequence_id as string | null;
  let startedAt = card.sequence_started_at as string | null;

  if (!sequenceId || !startedAt) {
    sequenceId = sequenceId ?? active.sequence.id;
    startedAt = startedAt ?? (card.outreach_at as string | null) ?? new Date().toISOString();
    const { error: updErr } = await supabase
      .from("crm_companies_pipeline")
      .update({
        sequence_id: sequenceId,
        sequence_started_at: startedAt,
      })
      .eq("id", cardId);
    if (updErr) throw new Error(updErr.message);
  }

  // Ensure state rows exist
  const { data: existing } = await supabase
    .from("crm_card_sequence_state")
    .select("step_id")
    .eq("card_id", cardId);
  const existingIds = new Set((existing ?? []).map((r) => r.step_id as string));
  const toInsert = active.steps
    .filter((s) => !existingIds.has(s.id))
    .map((s) => ({
      card_id: cardId,
      step_id: s.id,
      touch_status: "pending",
      response_status: "awaiting",
    }));
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("crm_card_sequence_state").insert(toInsert);
    if (insErr) throw new Error(insErr.message);
  }

  return {
    sequence_id: sequenceId!,
    sequence_started_at: startedAt!,
    steps: active.steps,
  };
}

export async function loadCardSequenceState(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  cardId: string
): Promise<CardStepState[]> {
  const { data, error } = await supabase
    .from("crm_card_sequence_state")
    .select("id, card_id, step_id, touch_status, response_status, done_at, variant_id, outcome, notes")
    .eq("card_id", cardId);
  if (error) throw new Error(error.message);
  return (data ?? []) as CardStepState[];
}

export async function syncCardCadenceFromSequence(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  cardId: string,
  steps: SequenceStepDef[],
  states: CardStepState[],
  card: {
    sequence_id: string | null;
    sequence_started_at: string | null;
    responded_at: string | null;
  }
) {
  const cadence = cadenceFieldsFromSequence(steps, states, card);
  const { error } = await supabase
    .from("crm_companies_pipeline")
    .update({
      next_follow_up_at: cadence.next_follow_up_at,
      next_action: cadence.next_action,
    })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
  return cadence;
}

export async function pickVariantForChannel(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
  channel: OutreachChannel,
  sequenceStepId?: string | null
): Promise<OutreachVariant | null> {
  const { data: variants } = await supabase
    .from("outreach_variants")
    .select("*")
    .eq("created_by_user_id", userId)
    .eq("channel", channel)
    .eq("is_active", true)
    .eq("archived", false);

  if (!variants?.length) return null;

  const ids = variants.map((v) => v.id as string);
  const { data: counts } = await supabase
    .from("crm_outreach_events")
    .select("variant_id")
    .eq("user_id", userId)
    .eq("event_type", "touch")
    .in("variant_id", ids);

  const sendCounts: Record<string, number> = {};
  for (const row of counts ?? []) {
    const id = row.variant_id as string;
    if (!id) continue;
    sendCounts[id] = (sendCounts[id] ?? 0) + 1;
  }

  return pickRoundRobinVariant(variants as OutreachVariant[], channel, {
    sequenceStepId,
    sendCounts,
  });
}
