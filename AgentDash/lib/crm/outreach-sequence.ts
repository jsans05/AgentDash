/** Outreach sequence channels and engine helpers. */

export type OutreachChannel =
  | "cold_email"
  | "support_email"
  | "instagram_dm"
  | "instagram_engage"
  | "linkedin"
  | "cold_call"
  | "other";

export type TouchStatus = "pending" | "done" | "skipped";
export type ResponseStatus = "awaiting" | "responded" | "no_response";

export type SequenceStepDef = {
  id: string;
  sequence_id: string;
  step_order: number;
  day_offset: number;
  channel: OutreachChannel;
  action_label: string;
  short_code: string;
  phase: string;
  expects_response: boolean;
  is_optional: boolean;
  guidance: string | null;
};

export type CardStepState = {
  id?: string;
  card_id: string;
  step_id: string;
  touch_status: TouchStatus;
  response_status: ResponseStatus;
  done_at: string | null;
  variant_id: string | null;
  outcome: string | null;
  notes: string | null;
};

export type SequenceCardFields = {
  sequence_id: string | null;
  sequence_started_at: string | null;
  responded_at: string | null;
  pipeline_stage?: string | null;
  circle_back_at?: string | null;
};

/** Main outreach chain — each step waits for the prior one. LI1–LI3 run in parallel. */
export const MAIN_SEQUENCE_CHAIN = [
  "E1",
  "E2",
  "C1",
  "IG1",
  "LI4",
  "SE1",
  "C2",
  "IG2",
  "BK1",
] as const;

/** Column order on the sequence board (includes parallel LinkedIn warm-up steps). */
export const SEQUENCE_DISPLAY_ORDER = [
  "LI1",
  "LI2",
  "LI3",
  "E1",
  "E2",
  "C1",
  "IG1",
  "LI4",
  "SE1",
  "C2",
  "IG2",
  "BK1",
] as const;

const CHANNEL_TO_NEXT_ACTION: Partial<
  Record<OutreachChannel, "email" | "linkedin" | "call" | "cool">
> = {
  cold_email: "email",
  support_email: "email",
  linkedin: "linkedin",
  cold_call: "call",
  instagram_dm: "email",
  instagram_engage: "email",
};

export function sortSequenceSteps(steps: SequenceStepDef[]): SequenceStepDef[] {
  const order = new Map(SEQUENCE_DISPLAY_ORDER.map((code, index) => [code, index]));
  return [...steps].sort((a, b) => {
    const ai = order.get(a.short_code as (typeof SEQUENCE_DISPLAY_ORDER)[number]) ?? 999;
    const bi = order.get(b.short_code as (typeof SEQUENCE_DISPLAY_ORDER)[number]) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.step_order - b.step_order;
  });
}

export function cycleTouchStatus(current: TouchStatus): TouchStatus {
  if (current === "pending") return "done";
  if (current === "done") return "skipped";
  return "pending";
}

export function cycleResponseStatus(current: ResponseStatus): ResponseStatus {
  if (current === "awaiting") return "responded";
  if (current === "responded") return "no_response";
  return "awaiting";
}

/** Due date for a step = sequence_started_at + day_offset (calendar days, UTC date). */
export function stepDueAt(sequenceStartedAt: string, dayOffset: number): Date {
  const start = new Date(sequenceStartedAt);
  const due = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + dayOffset, 10, 0, 0)
  );
  return due;
}

export function getDependencyPredecessor(
  step: SequenceStepDef,
  steps: SequenceStepDef[]
): SequenceStepDef | null {
  if (step.short_code === "LI2") {
    return steps.find((s) => s.short_code === "LI1") ?? null;
  }
  if (step.short_code === "LI3") {
    return steps.find((s) => s.short_code === "LI2") ?? null;
  }
  const idx = MAIN_SEQUENCE_CHAIN.indexOf(
    step.short_code as (typeof MAIN_SEQUENCE_CHAIN)[number]
  );
  if (idx <= 0) return null;
  return steps.find((s) => s.short_code === MAIN_SEQUENCE_CHAIN[idx - 1]) ?? null;
}

export function isPredecessorSatisfied(
  states: CardStepState[],
  predecessorStepId: string
): boolean {
  const st = getStepState(states, predecessorStepId);
  const touch = st?.touch_status ?? "pending";
  return touch === "done" || touch === "skipped";
}

/**
 * When a step has a predecessor, due date = predecessor done_at + gap days
 * (gap = difference in day_offset). Calls wait until prior emails were sent.
 */
export function effectiveStepDueAt(
  step: SequenceStepDef,
  steps: SequenceStepDef[],
  states: CardStepState[],
  sequenceStartedAt: string | null
): Date | null {
  if (!sequenceStartedAt) return null;

  const pred = getDependencyPredecessor(step, steps);
  if (!pred) {
    return stepDueAt(sequenceStartedAt, step.day_offset);
  }

  if (!isPredecessorSatisfied(states, pred.id)) {
    return null;
  }

  const predState = getStepState(states, pred.id);
  const gapDays = Math.max(0, step.day_offset - pred.day_offset);
  const anchor = predState?.done_at ?? sequenceStartedAt;
  const base = new Date(anchor);
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + gapDays,
      10,
      0,
      0
    )
  );
}

export function isStepDue(
  step: SequenceStepDef,
  steps: SequenceStepDef[],
  states: CardStepState[],
  sequenceStartedAt: string | null,
  touchStatus: TouchStatus,
  now = new Date()
): boolean {
  if (!sequenceStartedAt) return false;
  if (touchStatus !== "pending") return false;
  const dueAt = effectiveStepDueAt(step, steps, states, sequenceStartedAt);
  if (!dueAt) return false;
  return dueAt.getTime() <= now.getTime();
}

export function getStepState(
  states: CardStepState[],
  stepId: string
): CardStepState | undefined {
  return states.find((s) => s.step_id === stepId);
}

export function ensureStepState(
  cardId: string,
  stepId: string,
  states: CardStepState[]
): CardStepState {
  const existing = getStepState(states, stepId);
  if (existing) return existing;
  return {
    card_id: cardId,
    step_id: stepId,
    touch_status: "pending",
    response_status: "awaiting",
    done_at: null,
    variant_id: null,
    outcome: null,
    notes: null,
  };
}

/**
 * Next pending step that is due (or the earliest pending by order if none due yet).
 * Skips blocked steps. Pauses when card has responded.
 */
export function findNextPendingStep(
  steps: SequenceStepDef[],
  states: CardStepState[],
  card: SequenceCardFields,
  now = new Date()
): SequenceStepDef | null {
  if (card.responded_at) return null;
  if (!card.sequence_started_at) return null;

  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const pending = ordered.filter((step) => {
    const st = getStepState(states, step.id);
    const touch = st?.touch_status ?? "pending";
    if (touch !== "pending") return false;
    if (isStepBlocked(step, steps, states).blocked) return false;
    return true;
  });
  if (pending.length === 0) return null;

  const due = pending.filter((step) =>
    isStepDue(step, steps, states, card.sequence_started_at, "pending", now)
  );
  if (due.length > 0) return due[0]!;
  return pending[0]!;
}

/** Populate next_follow_up_at / next_action from the next pending sequence step. */
export function cadenceFieldsFromSequence(
  steps: SequenceStepDef[],
  states: CardStepState[],
  card: SequenceCardFields,
  now = new Date()
): {
  next_follow_up_at: string | null;
  next_action: "email" | "linkedin" | "call" | "cool" | "circle_back" | null;
  last_touch_at?: string | null;
} {
  if (card.circle_back_at) {
    return { next_follow_up_at: card.circle_back_at, next_action: "circle_back" };
  }
  if (card.responded_at) {
    return { next_follow_up_at: null, next_action: null };
  }
  const next = findNextPendingStep(steps, states, card, now);
  if (!next || !card.sequence_started_at) {
    return { next_follow_up_at: null, next_action: null };
  }
  const due =
    effectiveStepDueAt(next, steps, states, card.sequence_started_at) ??
    stepDueAt(card.sequence_started_at, next.day_offset);
  return {
    next_follow_up_at: due.toISOString(),
    next_action: CHANNEL_TO_NEXT_ACTION[next.channel] ?? "email",
  };
}

export function anyStepResponded(states: CardStepState[]): boolean {
  return states.some((s) => s.response_status === "responded");
}

/**
 * True when the sequence has been started, the card has not responded, and every
 * non-optional step is done or skipped (optional steps may still be pending).
 */
export function isSequenceExhausted(
  steps: SequenceStepDef[],
  states: CardStepState[],
  card: SequenceCardFields
): boolean {
  if (!card.sequence_started_at || card.responded_at) return false;
  const required = steps.filter((s) => !s.is_optional);
  if (required.length === 0) return false;
  return required.every((step) => {
    const touch = getStepState(states, step.id)?.touch_status ?? "pending";
    return touch === "done" || touch === "skipped";
  });
}

/** LI4 is gated on LI3 connection acceptance; main-chain steps wait on their predecessor. */
export function isStepBlocked(
  step: SequenceStepDef,
  steps: SequenceStepDef[],
  states: CardStepState[]
): { blocked: boolean; reason: string | null } {
  if (step.short_code === "LI4") {
    const conn = steps.find((s) => s.short_code === "LI3");
    if (conn) {
      const st = getStepState(states, conn.id);
      if (st?.response_status === "no_response") {
        return { blocked: true, reason: "Not connected — LI3 connection was declined" };
      }
      if (st?.touch_status === "pending") {
        return { blocked: true, reason: "Complete LI3 connection request first" };
      }
      if (st?.touch_status === "done" && st.response_status === "awaiting") {
        return { blocked: true, reason: "Waiting for connection acceptance (LI3)" };
      }
    }
  }

  const pred = getDependencyPredecessor(step, steps);
  if (pred && !isPredecessorSatisfied(states, pred.id)) {
    return { blocked: true, reason: `Complete ${pred.short_code} first` };
  }

  return { blocked: false, reason: null };
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case "warm_up":
      return "Phase 1 · Warm-Up";
    case "first_wave":
      return "Phase 2 · First Wave";
    case "channel_switch":
      return "Phase 3 · Channel Switch";
    case "exit":
      return "Phase 4 · Exit";
    default:
      return phase;
  }
}

export function channelLabel(channel: OutreachChannel | string): string {
  switch (channel) {
    case "cold_email":
      return "Cold email";
    case "support_email":
      return "Support email";
    case "instagram_dm":
      return "Instagram DM";
    case "instagram_engage":
      return "Instagram engage";
    case "linkedin":
      return "LinkedIn";
    case "cold_call":
      return "Cold call";
    default:
      return channel;
  }
}

export function mapLegacyChannel(raw: string): OutreachChannel {
  const c = raw.trim().toLowerCase();
  if (c === "linkedin") return "linkedin";
  if (c === "call" || c === "cold_call" || c === "phone") return "cold_call";
  if (c === "support_email" || c === "support") return "support_email";
  if (c === "instagram_dm" || c === "ig_dm" || c === "instagram") return "instagram_dm";
  if (c === "instagram_engage") return "instagram_engage";
  if (c === "email" || c === "cold_email") return "cold_email";
  return "other";
}
