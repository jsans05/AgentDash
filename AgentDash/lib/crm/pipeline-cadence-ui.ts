import type { PipelineStage } from "@/lib/crm/pipeline-stages";
import {
  cadenceBadgeLabel,
  type CadenceFields,
  type CadenceNextAction,
  type FollowUpLogEntry,
} from "@/lib/crm/pipeline-cadence";
import {
  enrichmentGapSignals,
  signalPriorityScore,
  signalsFromFirmographics,
  type FirmographicsEmbed,
} from "@/lib/crm/pipeline-signals";
import { normalizePipelineContacts } from "@/lib/crm/pipeline-contacts";

export type PipelineCadenceCard = {
  id: string;
  company_name: string;
  pipeline_stage: PipelineStage;
  outreach_at: string | null;
  responded_at: string | null;
  follow_up_step?: number;
  last_touch_at?: string | null;
  next_follow_up_at?: string | null;
  next_action?: CadenceNextAction | null;
  follow_up_log?: FollowUpLogEntry[] | null;
  pipeline_contacts?: unknown;
  hq_phone?: string | null;
  total_funding_printed?: string | null;
  latest_funding_stage?: string | null;
  headcount_twelve_month_growth?: number | null;
  firmographics_enriched_at?: string | null;
};

export function cardToCadenceFields(card: PipelineCadenceCard): CadenceFields {
  return {
    pipeline_stage: card.pipeline_stage,
    outreach_at: card.outreach_at,
    responded_at: card.responded_at,
    follow_up_step: card.follow_up_step ?? 0,
    last_touch_at: card.last_touch_at ?? null,
    next_follow_up_at: card.next_follow_up_at ?? null,
    next_action: card.next_action ?? null,
    follow_up_log: card.follow_up_log ?? null,
  };
}

export function getCadenceBadge(card: PipelineCadenceCard): string | null {
  return cadenceBadgeLabel(cardToCadenceFields(card));
}

export function getCardSignals(card: PipelineCadenceCard): ReturnType<typeof signalsFromFirmographics> {
  const firmo: FirmographicsEmbed = {
    total_funding_printed: card.total_funding_printed,
    latest_funding_stage: card.latest_funding_stage,
    headcount_twelve_month_growth: card.headcount_twelve_month_growth,
    firmographics_enriched_at: card.firmographics_enriched_at,
  };
  const slots = normalizePipelineContacts(card.pipeline_contacts);
  const primary = slots[0];
  const gaps = enrichmentGapSignals({
    hasEmail: Boolean(primary?.email?.trim()),
    hasPhone: Boolean(card.hq_phone?.trim()),
    hasLinkedin: Boolean(primary?.linkedin?.trim()),
  });
  return [...signalsFromFirmographics(firmo), ...gaps.filter((g) => g.id === "no_phone" && card.follow_up_step === 3)];
}

export function dueSortScore(card: PipelineCadenceCard): number {
  const fields = cardToCadenceFields(card);
  const due = isActionableDue(fields) ? 1000 : 0;
  const signal = signalPriorityScore(getCardSignals(card));
  const urgency =
    fields.next_action === "call" ? 50 : fields.follow_up_step === 5 ? 10 : 30;
  return due + signal * 10 + urgency;
}

export type DueBucket = "email" | "call" | "linkedin";

export function dueBucketForCard(card: PipelineCadenceCard): DueBucket | null {
  if (card.responded_at) return null;
  const fields = cardToCadenceFields(card);
  const step = fields.follow_up_step ?? 0;

  if (step === 5) return null;

  if (step === 3 || fields.next_action === "call") return "call";
  if (fields.next_action === "linkedin") return "linkedin";

  if (!isActionableDue(fields)) return null;

  return "email";
}

/** True when the card needs agent action now (not passive cooling). */
export function isActionableDue(fields: CadenceFields): boolean {
  if (fields.responded_at) return false;
  if (fields.follow_up_step === 5) return false;
  if (fields.pipeline_stage !== "outreach" && fields.pipeline_stage !== "follow_up") return false;

  if (fields.follow_up_step === 3) return true;

  if (!fields.next_follow_up_at) {
    return fields.follow_up_step >= 1 && fields.follow_up_step <= 4;
  }

  return new Date(fields.next_follow_up_at).getTime() <= Date.now();
}

export function listDueCards(cards: PipelineCadenceCard[]): PipelineCadenceCard[] {
  return cards
    .filter((c) => {
      if (c.responded_at) return false;
      const fields = cardToCadenceFields(c);
      if (fields.follow_up_step === 5) return false;
      if (fields.pipeline_stage !== "outreach" && fields.pipeline_stage !== "follow_up") return false;
      return isActionableDue(fields);
    })
    .sort((a, b) => dueSortScore(b) - dueSortScore(a));
}

export function listCoolingCards(cards: PipelineCadenceCard[]): PipelineCadenceCard[] {
  return cards.filter((c) => {
    if (c.responded_at) return false;
    const fields = cardToCadenceFields(c);
    return fields.follow_up_step === 5 && fields.pipeline_stage === "follow_up";
  });
}

export function countDueByBucket(cards: PipelineCadenceCard[]): Record<DueBucket, number> {
  const due = listDueCards(cards);
  return {
    email: due.filter((c) => dueBucketForCard(c) === "email").length,
    call: due.filter((c) => dueBucketForCard(c) === "call").length,
    linkedin: due.filter((c) => dueBucketForCard(c) === "linkedin").length,
  };
}

export function countDueInStage(
  cards: PipelineCadenceCard[],
  stage: PipelineStage
): { total: number; due: number; cooling: number } {
  const inStage = cards.filter((c) => c.pipeline_stage === stage);
  const due = listDueCards(inStage).length;
  const cooling = stage === "follow_up" ? listCoolingCards(inStage).length : 0;
  return { total: inStage.length, due, cooling };
}

export function cadenceStepLabel(step: number): string {
  switch (step) {
    case 0:
      return "Initial send";
    case 1:
      return "Follow-up 1";
    case 2:
      return "Follow-up 2";
    case 3:
      return "Call";
    case 4:
      return "Follow-up 3";
    case 5:
      return "Cooling period";
    default:
      return `Step ${step}`;
  }
}
