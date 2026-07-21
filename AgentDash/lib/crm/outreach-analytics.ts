import type { OutreachChannel } from "@/lib/crm/outreach-sequence";
import { channelLabel } from "@/lib/crm/outreach-sequence";
import { LOW_SAMPLE_THRESHOLD } from "@/lib/crm/outreach-variants";
import { DOW_LABELS } from "@/lib/crm/outreach-local-time";

export type OutreachEventRow = {
  id: string;
  pipeline_card_id: string | null;
  contact_id: string | null;
  user_id: string;
  event_type: "touch" | "response";
  channel: OutreachChannel | string;
  sequence_step_id: string | null;
  variant_id: string | null;
  product_category: string | null;
  occurred_at: string;
  outcome: string | null;
  recipient_timezone: string | null;
  recipient_local_hour: number | null;
  recipient_local_dow: number | null;
  /** Joined */
  variant_label?: string | null;
  step_short_code?: string | null;
  step_action_label?: string | null;
  step_order?: number | null;
};

export type ChannelPerf = {
  channel: string;
  label: string;
  touches: number;
  replies: number;
  replyRatePct: number | null;
  positiveReplies: number;
  positiveRatePct: number | null;
};

export type StepDropoff = {
  step_id: string;
  short_code: string;
  action_label: string;
  step_order: number;
  done: number;
  skipped: number;
  responses: number;
};

export type VariantCompare = {
  variant_id: string | null;
  label: string;
  channel: string;
  sends: number;
  replies: number;
  replyRatePct: number | null;
  positiveReplies: number;
  positiveRatePct: number | null;
  lowSample: boolean;
};

export type HourBucket = {
  hour: number;
  touches: number;
  replies: number;
  replyRatePct: number | null;
};

export type DowBucket = {
  dow: number;
  label: string;
  touches: number;
  replies: number;
  replyRatePct: number | null;
};

export type OutreachAnalyticsSnapshot = {
  scope: "mine" | "team";
  generatedAt: string;
  kpis: {
    totalTouches: number;
    totalReplies: number;
    replyRatePct: number | null;
    timezoneMissing: number;
    activeVariants: number;
  };
  channelPerformance: ChannelPerf[];
  stepDropoff: StepDropoff[];
  variantComparison: VariantCompare[];
  bestHours: HourBucket[];
  bestDow: DowBucket[];
  weeklyTouches: { week: string; count: number; replies: number }[];
};

function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export function buildOutreachAnalytics(
  events: OutreachEventRow[],
  opts: {
    scope: "mine" | "team";
    stepDefs?: Array<{
      id: string;
      short_code: string;
      action_label: string;
      step_order: number;
    }>;
    stateRows?: Array<{
      step_id: string;
      touch_status: string;
      response_status: string;
    }>;
  }
): OutreachAnalyticsSnapshot {
  const touches = events.filter((e) => e.event_type === "touch" && e.outcome !== "skipped");
  const replies = events.filter((e) => e.event_type === "response");
  const positive = replies.filter((e) => e.outcome === "positive");

  const timezoneMissing = touches.filter((e) => !e.recipient_timezone).length;

  // Channel performance
  const channelMap = new Map<string, { touches: number; replies: number; positive: number }>();
  for (const e of touches) {
    const c = e.channel || "other";
    const cur = channelMap.get(c) ?? { touches: 0, replies: 0, positive: 0 };
    cur.touches += 1;
    channelMap.set(c, cur);
  }
  for (const e of replies) {
    const c = e.channel || "other";
    const cur = channelMap.get(c) ?? { touches: 0, replies: 0, positive: 0 };
    cur.replies += 1;
    if (e.outcome === "positive") cur.positive += 1;
    channelMap.set(c, cur);
  }
  const channelPerformance: ChannelPerf[] = [...channelMap.entries()]
    .map(([channel, v]) => ({
      channel,
      label: channelLabel(channel),
      touches: v.touches,
      replies: v.replies,
      replyRatePct: rate(v.replies, v.touches),
      positiveReplies: v.positive,
      positiveRatePct: rate(v.positive, v.replies),
    }))
    .sort((a, b) => b.touches - a.touches);

  // Step drop-off from state rows when available, else from events
  const stepDropoff: StepDropoff[] = [];
  if (opts.stepDefs && opts.stateRows) {
    for (const step of [...opts.stepDefs].sort((a, b) => a.step_order - b.step_order)) {
      const rows = opts.stateRows.filter((r) => r.step_id === step.id);
      stepDropoff.push({
        step_id: step.id,
        short_code: step.short_code,
        action_label: step.action_label,
        step_order: step.step_order,
        done: rows.filter((r) => r.touch_status === "done").length,
        skipped: rows.filter((r) => r.touch_status === "skipped").length,
        responses: rows.filter((r) => r.response_status === "responded").length,
      });
    }
  } else {
    const byStep = new Map<string, StepDropoff>();
    for (const e of events) {
      if (!e.sequence_step_id) continue;
      const key = e.sequence_step_id;
      const cur =
        byStep.get(key) ??
        ({
          step_id: key,
          short_code: e.step_short_code ?? "?",
          action_label: e.step_action_label ?? "Step",
          step_order: e.step_order ?? 0,
          done: 0,
          skipped: 0,
          responses: 0,
        } satisfies StepDropoff);
      if (e.event_type === "touch") {
        if (e.outcome === "skipped") cur.skipped += 1;
        else cur.done += 1;
      } else {
        cur.responses += 1;
      }
      byStep.set(key, cur);
    }
    stepDropoff.push(...[...byStep.values()].sort((a, b) => a.step_order - b.step_order));
  }

  // Variant comparison
  const variantMap = new Map<
    string,
    { label: string; channel: string; sends: number; replies: number; positive: number }
  >();
  for (const e of touches) {
    const key = e.variant_id ?? `__ai__:${e.channel}`;
    const label = e.variant_id
      ? `Variant ${e.variant_label ?? "?"}`.trim()
      : "AI / ad-hoc draft";
    const cur = variantMap.get(key) ?? {
      label,
      channel: e.channel,
      sends: 0,
      replies: 0,
      positive: 0,
    };
    cur.sends += 1;
    variantMap.set(key, cur);
  }
  // Attribute replies to same channel's touches with matching variant when possible —
  // for simplicity count replies by variant_id on the response event.
  for (const e of replies) {
    const key = e.variant_id ?? `__ai__:${e.channel}`;
    const cur = variantMap.get(key);
    if (!cur) continue;
    cur.replies += 1;
    if (e.outcome === "positive") cur.positive += 1;
  }
  const variantComparison: VariantCompare[] = [...variantMap.entries()]
    .map(([key, v]) => ({
      variant_id: key.startsWith("__ai__:") ? null : key,
      label: v.label,
      channel: v.channel,
      sends: v.sends,
      replies: v.replies,
      replyRatePct: rate(v.replies, v.sends),
      positiveReplies: v.positive,
      positiveRatePct: rate(v.positive, v.replies),
      lowSample: v.sends < LOW_SAMPLE_THRESHOLD,
    }))
    .sort((a, b) => b.sends - a.sends);

  // Best hours / DOW
  const hourMap = new Map<number, { touches: number; replies: number }>();
  const dowMap = new Map<number, { touches: number; replies: number }>();
  for (let h = 0; h < 24; h++) hourMap.set(h, { touches: 0, replies: 0 });
  for (let d = 0; d < 7; d++) dowMap.set(d, { touches: 0, replies: 0 });

  for (const e of touches) {
    if (e.recipient_local_hour != null) {
      const cur = hourMap.get(e.recipient_local_hour)!;
      cur.touches += 1;
    }
    if (e.recipient_local_dow != null) {
      const cur = dowMap.get(e.recipient_local_dow)!;
      cur.touches += 1;
    }
  }
  for (const e of replies) {
    if (e.recipient_local_hour != null) {
      const cur = hourMap.get(e.recipient_local_hour)!;
      cur.replies += 1;
    }
    if (e.recipient_local_dow != null) {
      const cur = dowMap.get(e.recipient_local_dow)!;
      cur.replies += 1;
    }
  }

  const bestHours: HourBucket[] = [...hourMap.entries()].map(([hour, v]) => ({
    hour,
    touches: v.touches,
    replies: v.replies,
    replyRatePct: rate(v.replies, v.touches),
  }));
  const bestDow: DowBucket[] = [...dowMap.entries()].map(([dow, v]) => ({
    dow,
    label: DOW_LABELS[dow] ?? String(dow),
    touches: v.touches,
    replies: v.replies,
    replyRatePct: rate(v.replies, v.touches),
  }));

  // Weekly trends
  const weekMap = new Map<string, { count: number; replies: number }>();
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekMap.set(weekKey(d.toISOString()), { count: 0, replies: 0 });
  }
  for (const e of touches) {
    const k = weekKey(e.occurred_at);
    if (weekMap.has(k)) {
      const cur = weekMap.get(k)!;
      cur.count += 1;
    }
  }
  for (const e of replies) {
    const k = weekKey(e.occurred_at);
    if (weekMap.has(k)) {
      const cur = weekMap.get(k)!;
      cur.replies += 1;
    }
  }
  const weeklyTouches = [...weekMap.entries()].map(([week, v]) => ({
    week,
    count: v.count,
    replies: v.replies,
  }));

  const activeVariants = new Set(
    touches.filter((e) => e.variant_id).map((e) => e.variant_id as string)
  ).size;

  return {
    scope: opts.scope,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalTouches: touches.length,
      totalReplies: replies.length,
      replyRatePct: rate(replies.length, touches.length),
      timezoneMissing,
      activeVariants,
    },
    channelPerformance,
    stepDropoff,
    variantComparison,
    bestHours,
    bestDow,
    weeklyTouches,
  };
}
