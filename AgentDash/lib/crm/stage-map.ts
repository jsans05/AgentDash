import type { PipelineStage } from "@/lib/crm/pipeline-stages";

/** Legacy funnel vocabulary on crm_companies_pipeline (deprecated — use pipeline_stage). */
export const FUNNEL_STAGES = [
  "idea",
  "research",
  "contacted",
  "negotiating",
  "paused",
  "won",
  "lost",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_TO_PIPELINE: Record<FunnelStage, PipelineStage> = {
  idea: "target",
  research: "research",
  contacted: "outreach",
  negotiating: "in_progress",
  paused: "follow_up",
  won: "closed",
  lost: "ghost",
};

/** Higher ordinal = further along the operational funnel (max-wins backfill). */
export const PIPELINE_STAGE_ORDINAL: Record<PipelineStage, number> = {
  target: 0,
  research: 1,
  drafting: 2,
  outreach: 3,
  bounced: 3,
  follow_up: 4,
  ghost: 5,
  in_progress: 6,
  closed: 7,
};

export const PIPELINE_STAGES = new Set<string>(Object.keys(PIPELINE_STAGE_ORDINAL));

export function isFunnelStage(value: string): value is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}

export function pipelineStageFromFunnel(funnel: FunnelStage): PipelineStage {
  return FUNNEL_TO_PIPELINE[funnel];
}

export function normalizeFunnelStage(value: unknown, fallback: FunnelStage = "idea"): FunnelStage {
  const stage = String(value ?? "").trim().toLowerCase();
  return isFunnelStage(stage) ? stage : fallback;
}

export function normalizePipelineStage(value: unknown, fallback: PipelineStage = "target"): PipelineStage {
  const stage = String(value ?? "").trim().toLowerCase();
  if (PIPELINE_STAGES.has(stage)) return stage as PipelineStage;
  if (isFunnelStage(stage)) return pipelineStageFromFunnel(stage);
  return fallback;
}

/** Pick the more advanced stage when reconciling funnel vs pipeline columns. */
export function mergePipelineStages(
  current: PipelineStage,
  candidate: PipelineStage
): PipelineStage {
  return PIPELINE_STAGE_ORDINAL[candidate] >= PIPELINE_STAGE_ORDINAL[current] ? candidate : current;
}

export function pipelineStageToFunnel(stage: PipelineStage): FunnelStage {
  switch (stage) {
    case "target":
      return "idea";
    case "research":
    case "drafting":
      return "research";
    case "outreach":
    case "bounced":
      return "contacted";
    case "follow_up":
      return "paused";
    case "ghost":
      return "lost";
    case "in_progress":
      return "negotiating";
    case "closed":
      return "won";
    default:
      return "idea";
  }
}

export function resolvePipelineStageFromBody(body: {
  pipeline_stage?: unknown;
  funnel_stage?: unknown;
  stage?: unknown;
}): PipelineStage | undefined {
  if (body.pipeline_stage !== undefined) {
    return normalizePipelineStage(body.pipeline_stage);
  }
  if (body.funnel_stage !== undefined) {
    return pipelineStageFromFunnel(normalizeFunnelStage(body.funnel_stage));
  }
  if (body.stage !== undefined) {
    return normalizePipelineStage(body.stage);
  }
  return undefined;
}
