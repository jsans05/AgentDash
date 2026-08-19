import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { quarantineEmail } from "@/lib/crm/email-quarantine";
import { isSequenceExhausted, type CardStepState, type SequenceStepDef } from "@/lib/crm/outreach-sequence";
import { pipelineStageToFunnel, normalizePipelineStage } from "@/lib/crm/stage-map";
type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;
export type SequenceLifecycleResult = {
  pipeline_stage?: string;
  sequence_id?: string | null;
  sequence_started_at?: string | null;
  sequence_contact_id?: string | null;
  contact_of_record_id?: string | null;
  moved_to_ghost?: boolean;
  moved_to_bounced?: boolean;
  needs_next_contact?: boolean;
  bounced_contact_id?: string | null;
  deleted_contact_id?: string | null;
  dropped_company?: boolean;
  remaining_contacts?: number;
};
async function countViableContacts(supabase: SupabaseClient, companyId: string, userId: string): Promise<number> {
  // red_bounced contacts are archived, so archived=false is the viable set
  const {
    count,
    error
  } = await supabase.from("crm_contacts").select("contact_id", {
    count: "exact",
    head: true
  }).eq("company_id", companyId).eq("created_by_user_id", userId).eq("archived", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
async function resetCardSequence(supabase: SupabaseClient, cardId: string) {
  await supabase.from("crm_card_sequence_state").delete().eq("card_id", cardId);
  await supabase.from("crm_companies_pipeline").update({
    sequence_started_at: null,
    sequence_contact_id: null,
    next_follow_up_at: null,
    next_action: null,
    circle_back_at: null,
    circle_back_note: null
  }).eq("id", cardId);
}
async function moveCardToGhost(supabase: SupabaseClient, cardId: string) {
  const stage = normalizePipelineStage("ghost");
  await supabase.from("crm_companies_pipeline").update({
    pipeline_stage: stage,
    funnel_stage: pipelineStageToFunnel(stage),
    sequence_started_at: null,
    sequence_contact_id: null,
    next_follow_up_at: null,
    next_action: null,
    follow_up_step: 0,
    circle_back_at: null,
    circle_back_note: null
  }).eq("id", cardId);
  await supabase.from("crm_card_sequence_state").delete().eq("card_id", cardId);
}
async function moveCardToBounced(supabase: SupabaseClient, cardId: string) {
  const stage = normalizePipelineStage("bounced");
  await supabase.from("crm_companies_pipeline").update({
    pipeline_stage: stage,
    funnel_stage: pipelineStageToFunnel(stage),
    sequence_started_at: null,
    sequence_contact_id: null,
    next_follow_up_at: null,
    next_action: null,
    circle_back_at: null,
    circle_back_note: null
  }).eq("id", cardId);
  await supabase.from("crm_card_sequence_state").delete().eq("card_id", cardId);
}

/**
 * After a touch marks the sequence exhausted: ghost if this was the last viable
 * contact, otherwise clear talking-to so the user can pick the next person.
 */
export async function applySequenceExhaustionIfNeeded(supabase: SupabaseClient, opts: {
  cardId: string;
  userId: string;
  steps: SequenceStepDef[];
  states: CardStepState[];
  sequenceStartedAt: string | null;
  respondedAt: string | null;
}): Promise<SequenceLifecycleResult | null> {
  if (!isSequenceExhausted(opts.steps, opts.states, {
    sequence_id: null,
    sequence_started_at: opts.sequenceStartedAt,
    responded_at: opts.respondedAt
  })) {
    return null;
  }
  const {
    data: card,
    error
  } = await supabase.from("crm_companies_pipeline").select("id, company_id, created_by_user_id, contact_of_record_id, sequence_contact_id").eq("id", opts.cardId).single();
  if (error || !card) throw new Error(error?.message ?? "Card not found");
  const remaining = await countViableContacts(supabase, String(card.company_id), opts.userId);
  if (remaining <= 1) {
    await moveCardToGhost(supabase, opts.cardId);
    return {
      pipeline_stage: "ghost",
      sequence_started_at: null,
      sequence_contact_id: null,
      moved_to_ghost: true,
      remaining_contacts: remaining
    };
  }
  await resetCardSequence(supabase, opts.cardId);
  return {
    pipeline_stage: undefined,
    sequence_started_at: null,
    sequence_contact_id: null,
    needs_next_contact: true,
    remaining_contacts: remaining
  };
}

/** Mark a contact bounced and advance the pipeline card (bounced or ghost). */
export async function bounceSequenceContact(supabase: SupabaseClient, opts: {
  cardId: string;
  contactId: string;
  userId: string;
}): Promise<SequenceLifecycleResult> {
  const {
    data: card,
    error: cardErr
  } = await supabase.from("crm_companies_pipeline").select("id, company_id, created_by_user_id, contact_of_record_id, sequence_contact_id, pipeline_contacts").eq("id", opts.cardId).eq("created_by_user_id", opts.userId).single();
  if (cardErr || !card) throw new Error(cardErr?.message ?? "Card not found");
  const {
    data: contact,
    error: contactErr
  } = await supabase.from("crm_contacts").select("contact_id, email, company_id, created_by_user_id, status_tag").eq("contact_id", opts.contactId).eq("created_by_user_id", opts.userId).single();
  if (contactErr || !contact) throw new Error(contactErr?.message ?? "Contact not found");
  if (contact.company_id !== card.company_id) {
    throw new Error("Contact is not on this company");
  }
  const {
    error: updErr
  } = await supabase.from("crm_contacts").update({
    status_tag: "red_bounced",
    archived: true
  }).eq("contact_id", opts.contactId);
  if (updErr) throw new Error(updErr.message);
  if (contact.email) {
    try {
      const supabaseAdmin = await createServiceRoleClient();
      await quarantineEmail({
        supabaseAdmin,
        email: String(contact.email),
        reason: "contact_red_bounced",
        userId: opts.userId,
        companyId: String(card.company_id),
        contactId: opts.contactId,
        pipelineId: opts.cardId
      });
    } catch {
      // Non-fatal — contact is already marked bounced
    }
  }
  const clearOfRecord = card.contact_of_record_id === opts.contactId;
  const clearSequence = card.sequence_contact_id === opts.contactId;
  const remaining = await countViableContacts(supabase, String(card.company_id), opts.userId);
  if (remaining === 0) {
    await moveCardToGhost(supabase, opts.cardId);
    return {
      pipeline_stage: "ghost",
      sequence_started_at: null,
      sequence_contact_id: null,
      contact_of_record_id: clearOfRecord ? null : card.contact_of_record_id as string | null,
      moved_to_ghost: true,
      bounced_contact_id: opts.contactId,
      remaining_contacts: 0
    };
  }
  await moveCardToBounced(supabase, opts.cardId);
  const patch: Record<string, unknown> = {};
  if (clearOfRecord) patch.contact_of_record_id = null;
  if (clearSequence) patch.sequence_contact_id = null;
  if (Object.keys(patch).length > 0) {
    await supabase.from("crm_companies_pipeline").update(patch).eq("id", opts.cardId);
  }
  return {
    pipeline_stage: "bounced",
    sequence_started_at: null,
    sequence_contact_id: clearSequence ? null : card.sequence_contact_id as string | null,
    contact_of_record_id: clearOfRecord ? null : card.contact_of_record_id as string | null,
    moved_to_bounced: true,
    needs_next_contact: true,
    bounced_contact_id: opts.contactId,
    remaining_contacts: remaining
  };
}
async function archivePipelineCard(supabase: SupabaseClient, cardId: string) {
  await supabase.from("crm_card_sequence_state").delete().eq("card_id", cardId);
  const {
    error
  } = await supabase.from("crm_companies_pipeline").update({
    archived: true,
    sequence_started_at: null,
    sequence_contact_id: null,
    contact_of_record_id: null,
    next_follow_up_at: null,
    next_action: null,
    circle_back_at: null,
    circle_back_note: null
  }).eq("id", cardId);
  if (error) throw new Error(error.message);
}

/** Permanently delete a contact; drop the pipeline company if none remain. */
export async function deleteSequenceContact(supabase: SupabaseClient, opts: {
  cardId: string;
  contactId: string;
  userId: string;
}): Promise<SequenceLifecycleResult> {
  const {
    data: card,
    error: cardErr
  } = await supabase.from("crm_companies_pipeline").select("id, company_id, created_by_user_id, contact_of_record_id, sequence_contact_id").eq("id", opts.cardId).eq("created_by_user_id", opts.userId).single();
  if (cardErr || !card) throw new Error(cardErr?.message ?? "Card not found");
  const {
    data: contact,
    error: contactErr
  } = await supabase.from("crm_contacts").select("contact_id, company_id").eq("contact_id", opts.contactId).eq("created_by_user_id", opts.userId).single();
  if (contactErr || !contact) throw new Error(contactErr?.message ?? "Contact not found");
  if (contact.company_id !== card.company_id) {
    throw new Error("Contact is not on this company");
  }
  const clearOfRecord = card.contact_of_record_id === opts.contactId;
  const clearSequence = card.sequence_contact_id === opts.contactId;
  const {
    error: delErr
  } = await supabase.from("crm_contacts").delete().eq("contact_id", opts.contactId).eq("created_by_user_id", opts.userId);
  if (delErr) throw new Error(delErr.message);
  const patch: Record<string, unknown> = {};
  if (clearOfRecord) patch.contact_of_record_id = null;
  if (clearSequence) {
    patch.sequence_contact_id = null;
    patch.sequence_started_at = null;
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from("crm_companies_pipeline").update(patch).eq("id", opts.cardId);
  }
  if (clearSequence) {
    await supabase.from("crm_card_sequence_state").delete().eq("card_id", opts.cardId);
  }
  const remaining = await countViableContacts(supabase, String(card.company_id), opts.userId);
  if (remaining === 0) {
    await archivePipelineCard(supabase, opts.cardId);
    return {
      deleted_contact_id: opts.contactId,
      dropped_company: true,
      remaining_contacts: 0,
      sequence_contact_id: null,
      contact_of_record_id: null,
      sequence_started_at: null
    };
  }
  return {
    deleted_contact_id: opts.contactId,
    remaining_contacts: remaining,
    sequence_contact_id: clearSequence ? null : card.sequence_contact_id as string | null,
    contact_of_record_id: clearOfRecord ? null : card.contact_of_record_id as string | null,
    sequence_started_at: clearSequence ? null : undefined,
    needs_next_contact: clearSequence
  };
}

/** Remove a company from the pipeline (archive the card). */
export async function dropPipelineCompany(supabase: SupabaseClient, opts: {
  cardId: string;
  userId: string;
}): Promise<SequenceLifecycleResult> {
  const {
    data: card,
    error
  } = await supabase.from("crm_companies_pipeline").select("id").eq("id", opts.cardId).eq("created_by_user_id", opts.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!card) throw new Error("Card not found");
  await archivePipelineCard(supabase, opts.cardId);
  return {
    dropped_company: true,
    sequence_contact_id: null,
    contact_of_record_id: null,
    sequence_started_at: null
  };
}