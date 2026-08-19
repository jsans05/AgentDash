import { snapToTueThuMorning } from "@/lib/crm/pipeline-cadence";

export const DEFAULT_CIRCLE_BACK_MONTHS = 2;
export const CIRCLE_BACK_MONTH_PRESETS = [1, 2, 3, 6] as const;

const MS_DAY = 86_400_000;

export function addCalendarMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export function addMonthsSnapped(from: Date, months: number): string {
  return snapToTueThuMorning(addCalendarMonths(from, months)).toISOString();
}

export function resolveCircleBackAt(
  input: { months?: number | null; follow_up_at?: string | null },
  now = new Date()
): string {
  const raw = String(input.follow_up_at ?? "").trim();
  if (raw) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid follow_up_at");
    }
    if (parsed.getTime() <= now.getTime()) {
      throw new Error("Circle-back date must be in the future");
    }
    return parsed.toISOString();
  }

  const months = input.months == null ? DEFAULT_CIRCLE_BACK_MONTHS : Number(input.months);
  if (!Number.isFinite(months) || months < 1 || months > 18) {
    throw new Error("months must be between 1 and 18");
  }
  return addMonthsSnapped(now, months);
}

export function isCircleBackDue(circleBackAt: string | null | undefined, now = new Date()): boolean {
  if (!circleBackAt) return false;
  return new Date(circleBackAt).getTime() <= now.getTime();
}

export function circleBackDaysLeft(circleBackAt: string, now = new Date()): number {
  return Math.ceil((new Date(circleBackAt).getTime() - now.getTime()) / MS_DAY);
}

export function circleBackBadgeLabel(
  circleBackAt: string | null | undefined,
  now = new Date()
): string | null {
  if (!circleBackAt) return null;
  if (isCircleBackDue(circleBackAt, now)) return "Circle back due";
  const days = Math.max(0, circleBackDaysLeft(circleBackAt, now));
  return `Circle back · ${days}d`;
}

export function formatCircleBackWhen(circleBackAt: string, now = new Date()): string {
  const due = new Date(circleBackAt);
  const date = due.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (isCircleBackDue(circleBackAt, now)) return `Due ${date}`;
  return date;
}

export function buildCircleBackCardUpdates(opts: {
  circleBackAt: string;
  note?: string | null;
  now?: Date;
}): {
  responded_at: string;
  circle_back_at: string;
  circle_back_note: string | null;
  next_follow_up_at: string;
  next_action: "circle_back";
  pipeline_stage: "follow_up";
} {
  const now = opts.now ?? new Date();
  const note = opts.note != null ? String(opts.note).trim() : "";
  return {
    responded_at: now.toISOString(),
    circle_back_at: opts.circleBackAt,
    circle_back_note: note || null,
    next_follow_up_at: opts.circleBackAt,
    next_action: "circle_back",
    pipeline_stage: "follow_up",
  };
}

export function clearCircleBackCardUpdates(): {
  circle_back_at: null;
  circle_back_note: null;
} {
  return {
    circle_back_at: null,
    circle_back_note: null,
  };
}
