import type { PipelineStage } from "@/lib/crm/pipeline-stages";
import { STAGES, normalizeDisplayStage } from "@/lib/crm/pipeline-stages";
import { normalizeFollowUpLog } from "@/lib/crm/pipeline-cadence";
import {
  countDueByBucket,
  listCoolingCards,
  listDueCards,
  type PipelineCadenceCard,
} from "@/lib/crm/pipeline-cadence-ui";

export type PipelineAnalyticsRow = PipelineCadenceCard & {
  id: string;
  created_by_user_id: string;
  archived?: boolean | null;
  closed_value?: number | null;
  updated_at?: string;
  created_at?: string;
  product_category?: string | null;
};

export type PipelineImprovement = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  count?: number;
};

export type PipelineAnalyticsSnapshot = {
  scope: "mine" | "team";
  generatedAt: string;
  kpis: {
    totalActive: number;
    inOutreachFlow: number;
    dueNow: number;
    cooling: number;
    responseRatePct: number | null;
    closedDeals: number;
    closedValue: number;
    avgDaysToResponse: number | null;
  };
  stageCounts: { stage: PipelineStage; label: string; count: number }[];
  dueBuckets: { email: number; call: number; linkedin: number };
  categoryMix: { name: string; count: number }[];
  improvements: PipelineImprovement[];
  weeklyTouches: { week: string; count: number }[];
};

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

function contactHasPhone(card: PipelineCadenceCard): boolean {
  return Boolean(card.hq_phone?.trim());
}

export function buildPipelineAnalytics(
  rows: PipelineAnalyticsRow[],
  scope: "mine" | "team"
): PipelineAnalyticsSnapshot {
  const active = rows.filter((r) => !r.archived);
  const cadenceCards = active.map((r) => ({
    ...r,
    pipeline_stage: normalizeDisplayStage(r.pipeline_stage),
  }));

  const due = listDueCards(cadenceCards);
  const cooling = listCoolingCards(cadenceCards);
  const dueBuckets = countDueByBucket(cadenceCards);

  const withOutreach = active.filter((r) => r.outreach_at);
  const responded = withOutreach.filter((r) => r.responded_at);
  const responseRatePct =
    withOutreach.length > 0 ? Math.round((responded.length / withOutreach.length) * 100) : null;

  const responseDays = responded
    .filter((r) => r.outreach_at && r.responded_at)
    .map((r) => daysBetween(r.outreach_at!, r.responded_at!))
    .filter((d) => d >= 0);
  const avgDaysToResponse =
    responseDays.length > 0
      ? Math.round((responseDays.reduce((a, b) => a + b, 0) / responseDays.length) * 10) / 10
      : null;

  const closed = active.filter((r) => normalizeDisplayStage(r.pipeline_stage) === "closed");
  const closedValue = closed.reduce((sum, r) => sum + (Number(r.closed_value) || 0), 0);

  const outreachFlow = active.filter((r) => {
    const s = normalizeDisplayStage(r.pipeline_stage);
    return ["outreach", "follow_up", "bounced"].includes(s);
  });

  const stageCounts = STAGES.map((s) => ({
    stage: s.id,
    label: s.label,
    count: active.filter((r) => normalizeDisplayStage(r.pipeline_stage) === s.id).length,
  })).filter((s) => s.count > 0);

  const categoryMap = new Map<string, number>();
  for (const r of active) {
    const cat = r.product_category?.trim() || "Uncategorized";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
  }
  const categoryMix = [...categoryMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const weekMap = new Map<string, number>();
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weekMap.set(weekKey(d.toISOString()), 0);
  }
  for (const r of active) {
    if (r.outreach_at) {
      const k = weekKey(r.outreach_at);
      if (weekMap.has(k)) weekMap.set(k, (weekMap.get(k) ?? 0) + 1);
    }
    for (const entry of normalizeFollowUpLog(r.follow_up_log)) {
      const k = weekKey(entry.sent_at);
      if (weekMap.has(k)) weekMap.set(k, (weekMap.get(k) ?? 0) + 1);
    }
  }
  const weeklyTouches = [...weekMap.entries()].map(([week, count]) => ({ week, count }));

  const improvements = buildImprovements(active, cadenceCards, due.length, cooling.length, responseRatePct);

  return {
    scope,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalActive: active.length,
      inOutreachFlow: outreachFlow.length,
      dueNow: due.length,
      cooling: cooling.length,
      responseRatePct,
      closedDeals: closed.length,
      closedValue,
      avgDaysToResponse,
    },
    stageCounts,
    dueBuckets,
    categoryMix,
    improvements,
    weeklyTouches,
  };
}

function buildImprovements(
  active: PipelineAnalyticsRow[],
  cadenceCards: PipelineCadenceCard[],
  dueCount: number,
  coolingCount: number,
  responseRatePct: number | null
): PipelineImprovement[] {
  const out: PipelineImprovement[] = [];

  if (dueCount >= 8) {
    out.push({
      id: "due_backlog",
      severity: "high",
      title: "Clear your due backlog",
      detail: `${dueCount} cards need email, call, or follow-up action this week.`,
      count: dueCount,
    });
  }

  const staleTarget = active.filter((r) => {
    const s = normalizeDisplayStage(r.pipeline_stage);
    if (s !== "target" && s !== "drafting") return false;
    const ref = r.updated_at ?? r.created_at;
    if (!ref) return false;
    return daysBetween(ref, new Date().toISOString()) > 21;
  });
  if (staleTarget.length >= 5) {
    out.push({
      id: "stale_backlog",
      severity: "medium",
      title: "Stale research backlog",
      detail: `${staleTarget.length} brands sitting in Target/Drafted over 3 weeks — advance or archive.`,
      count: staleTarget.length,
    });
  }

  const bounced = active.filter((r) => normalizeDisplayStage(r.pipeline_stage) === "bounced");
  if (bounced.length >= 3) {
    out.push({
      id: "bounced",
      severity: "medium",
      title: "Bounced emails need new contacts",
      detail: `${bounced.length} cards in Bounced — find alternate contacts or quarantine bad addresses.`,
      count: bounced.length,
    });
  }

  if (responseRatePct != null && active.filter((r) => r.outreach_at).length >= 5 && responseRatePct < 15) {
    out.push({
      id: "low_response",
      severity: "high",
      title: "Low reply rate on sent outreach",
      detail: `Only ${responseRatePct}% of contacted brands replied — test subject lines, timing (Tue–Thu AM), and multi-channel touches.`,
    });
  }

  if (coolingCount >= 5) {
    out.push({
      id: "cooling",
      severity: "low",
      title: "Cards entering ghost soon",
      detail: `${coolingCount} cards in cooling — last chance to call or re-engage before auto-ghost.`,
      count: coolingCount,
    });
  }

  const callDueNoPhone = cadenceCards.filter(
    (c) => (c.follow_up_step === 3 || c.next_action === "call") && !contactHasPhone(c)
  );
  if (callDueNoPhone.length >= 2) {
    out.push({
      id: "missing_phone",
      severity: "medium",
      title: "Calls blocked — missing phone numbers",
      detail: `${callDueNoPhone.length} cards are call-due but have no HQ phone — run Apollo reveal.`,
      count: callDueNoPhone.length,
    });
  }

  const heavyTarget = active.filter((r) => normalizeDisplayStage(r.pipeline_stage) === "target").length;
  const activePipeline = active.filter((r) => {
    const s = normalizeDisplayStage(r.pipeline_stage);
    return !["target", "closed", "ghost"].includes(s);
  }).length;
  if (heavyTarget > activePipeline * 3 && heavyTarget > 50) {
    out.push({
      id: "target_heavy",
      severity: "medium",
      title: "Top of funnel overload",
      detail: `${heavyTarget} in Target vs ${activePipeline} in active outreach — focus on advancing drafted/sent cards.`,
      count: heavyTarget,
    });
  }

  return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(s: PipelineImprovement["severity"]): number {
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}
