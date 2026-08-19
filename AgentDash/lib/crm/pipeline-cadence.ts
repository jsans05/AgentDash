import type { PipelineStage } from "@/lib/crm/pipeline-stages";

export type CadenceNextAction = "email" | "linkedin" | "call" | "cool" | "circle_back";

export type FollowUpLogEntry = {
  step: number;
  channel: "email" | "linkedin" | "call" | CadenceNextAction;
  sent_at: string;
  outcome?: string | null;
  draft_id?: string | null;
};

export type CadenceFields = {
  pipeline_stage: PipelineStage;
  outreach_at: string | null;
  responded_at: string | null;
  follow_up_step: number;
  last_touch_at: string | null;
  next_follow_up_at: string | null;
  next_action: CadenceNextAction | null;
  follow_up_log: FollowUpLogEntry[] | null;
  circle_back_at?: string | null;
  circle_back_note?: string | null;
};

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;
const MS_COOL = 14 * MS_DAY;

export function normalizeFollowUpLog(raw: unknown): FollowUpLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowUpLogEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const sent_at = String(e.sent_at ?? "").trim();
    if (!sent_at) continue;
    out.push({
      step: Number(e.step ?? 0),
      channel: String(e.channel ?? "email") as FollowUpLogEntry["channel"],
      sent_at,
      outcome: e.outcome != null ? String(e.outcome) : null,
      draft_id: e.draft_id != null ? String(e.draft_id) : null,
    });
  }
  return out;
}

/** Snap a date to the next Tue–Thu morning (10:00 local). */
export function snapToTueThuMorning(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(10, 0, 0, 0);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  if (day === 1) {
    d.setDate(d.getDate() + 1);
  } else if (day === 5) {
    d.setDate(d.getDate() + 4);
  } else if (day === 6) {
    d.setDate(d.getDate() + 3);
  } else if (day === 0) {
    d.setDate(d.getDate() + 2);
  }
  return d;
}

export function addDaysSnapped(from: Date, days: number): string {
  const base = new Date(from.getTime() + days * MS_DAY);
  return snapToTueThuMorning(base).toISOString();
}

export function cadenceBadgeLabel(card: CadenceFields): string | null {
  if (card.circle_back_at) {
    const dueMs = new Date(card.circle_back_at).getTime();
    if (dueMs <= Date.now()) return "Circle back due";
    const daysLeft = Math.max(0, Math.ceil((dueMs - Date.now()) / MS_DAY));
    return `Circle back · ${daysLeft}d`;
  }
  if (card.responded_at) return null;
  if (card.pipeline_stage === "outreach" && card.follow_up_step === 0) {
    if (isCadenceDue(card)) return "FU1 due";
    return "Sent";
  }
  if (card.pipeline_stage !== "follow_up" && card.pipeline_stage !== "outreach") return null;

  switch (card.follow_up_step) {
    case 1:
      return "FU1 due";
    case 2:
      return "FU2 due";
    case 3:
      return "Call due";
    case 4:
      return "FU3 due";
    case 5: {
      if (!card.next_follow_up_at) return "Cooling";
      const daysLeft = Math.max(
        0,
        Math.ceil((new Date(card.next_follow_up_at).getTime() - Date.now()) / MS_DAY)
      );
      return `Cooling · ${daysLeft}d`;
    }
    default:
      return card.next_action === "call" ? "Call due" : null;
  }
}

export function isCadenceDue(card: CadenceFields): boolean {
  if (card.circle_back_at) {
    return new Date(card.circle_back_at).getTime() <= Date.now();
  }
  if (card.responded_at) return false;
  if (!card.next_follow_up_at) return false;
  return new Date(card.next_follow_up_at).getTime() <= Date.now();
}

export function initCadenceOnSend(now = new Date()): Partial<CadenceFields> {
  const iso = now.toISOString();
  return {
    outreach_at: iso,
    last_touch_at: iso,
    follow_up_step: 0,
    next_action: "email",
    next_follow_up_at: addDaysSnapped(now, 7),
    follow_up_log: [],
  };
}

export function clearCadenceOnResponded(now = new Date()): Partial<CadenceFields> {
  return {
    responded_at: now.toISOString(),
    next_action: null,
    next_follow_up_at: null,
    follow_up_step: 0,
    circle_back_at: null,
    circle_back_note: null,
  };
}

export function resetCadenceOnReengage(): Partial<CadenceFields> {
  return {
    outreach_at: null,
    responded_at: null,
    last_touch_at: null,
    follow_up_step: 0,
    next_action: null,
    next_follow_up_at: null,
    follow_up_log: [],
    circle_back_at: null,
    circle_back_note: null,
  };
}

function appendLog(
  log: FollowUpLogEntry[] | null,
  entry: FollowUpLogEntry
): FollowUpLogEntry[] {
  return [...normalizeFollowUpLog(log), entry];
}

export type CadenceTouchInput = {
  channel: "email" | "linkedin" | "call";
  outcome?: string | null;
  draft_id?: string | null;
};

/** Advance cadence when agent marks a touch (email, LinkedIn, or call). */
export function applyCadenceTouch(
  card: CadenceFields,
  input: CadenceTouchInput,
  now = new Date()
): Partial<CadenceFields> | null {
  if (card.responded_at) return null;
  const iso = now.toISOString();
  const log = normalizeFollowUpLog(card.follow_up_log);

  if (input.channel === "linkedin") {
    return {
      last_touch_at: iso,
      follow_up_log: appendLog(log, {
        step: card.follow_up_step,
        channel: "linkedin",
        sent_at: iso,
        outcome: input.outcome ?? null,
      }),
    };
  }

  if (input.channel === "call") {
    if (card.follow_up_step !== 3 && card.next_action !== "call") {
      return {
        last_touch_at: iso,
        follow_up_log: appendLog(log, {
          step: card.follow_up_step,
          channel: "call",
          sent_at: iso,
          outcome: input.outcome ?? null,
        }),
      };
    }
    return {
      last_touch_at: iso,
      follow_up_step: 4,
      next_action: "email",
      next_follow_up_at: addDaysSnapped(now, 7),
      pipeline_stage: "follow_up",
      follow_up_log: appendLog(log, {
        step: 3,
        channel: "call",
        sent_at: iso,
        outcome: input.outcome ?? null,
      }),
    };
  }

  // email touch — advances follow-up sequence
  const step = card.follow_up_step;
  const entry: FollowUpLogEntry = {
    step,
    channel: "email",
    sent_at: iso,
    draft_id: input.draft_id ?? null,
  };

  if (step === 0 || step === 1) {
    return {
      last_touch_at: iso,
      follow_up_step: 2,
      next_action: "email",
      next_follow_up_at: addDaysSnapped(now, 7),
      pipeline_stage: "follow_up",
      follow_up_log: appendLog(log, { ...entry, step: 1 }),
    };
  }
  if (step === 2) {
    return {
      last_touch_at: iso,
      follow_up_step: 3,
      next_action: "call",
      next_follow_up_at: snapToTueThuMorning(now).toISOString(),
      pipeline_stage: "follow_up",
      follow_up_log: appendLog(log, { ...entry, step: 2 }),
    };
  }
  if (step === 4) {
    return {
      last_touch_at: iso,
      follow_up_step: 5,
      next_action: "cool",
      next_follow_up_at: new Date(now.getTime() + MS_COOL).toISOString(),
      pipeline_stage: "follow_up",
      follow_up_log: appendLog(log, { ...entry, step: 4 }),
    };
  }

  return {
    last_touch_at: iso,
    follow_up_log: appendLog(log, entry),
  };
}

/** Server cron / due processing — auto-advance time-based transitions. */
export function processCadenceDue(
  card: CadenceFields,
  now = new Date()
): Partial<CadenceFields> | null {
  if (card.circle_back_at) return null;
  if (card.responded_at) return null;
  if (!card.next_follow_up_at) return null;
  if (new Date(card.next_follow_up_at).getTime() > now.getTime()) return null;

  const stage = card.pipeline_stage;

  if (card.follow_up_step === 5 && (stage === "follow_up" || stage === "ghost")) {
    return {
      pipeline_stage: "ghost",
      next_action: null,
    };
  }

  if (card.follow_up_step === 0 && stage === "outreach" && card.outreach_at) {
    return {
      pipeline_stage: "follow_up",
      follow_up_step: 1,
      next_action: "email",
    };
  }

  return null;
}

export function countEmailsSent(card: CadenceFields): number {
  const fromLog = normalizeFollowUpLog(card.follow_up_log).filter((e) => e.channel === "email").length;
  if (fromLog > 0) return fromLog;
  if (!card.outreach_at) return 0;
  if (card.follow_up_step >= 1) return Math.min(4, card.follow_up_step >= 4 ? 4 : card.follow_up_step + 1);
  return 1;
}
