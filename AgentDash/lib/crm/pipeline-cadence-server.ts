import type { CadenceFields } from "@/lib/crm/pipeline-cadence";
import { applyCadenceTouch, initCadenceOnSend, processCadenceDue, resetCadenceOnReengage } from "@/lib/crm/pipeline-cadence";
import { normalizePipelineStage, pipelineStageToFunnel } from "@/lib/crm/stage-map";

export function buildCadenceUpdatesForStageChange(
  current: CadenceFields & { pipeline_stage: string },
  newStage: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const normalized = normalizePipelineStage(newStage);

  if (normalized === "outreach" && !current.outreach_at && !Object.prototype.hasOwnProperty.call(body, "outreach_at")) {
    Object.assign(updates, initCadenceOnSend());
  }

  if (normalized === "in_progress") {
    updates.circle_back_at = null;
    updates.circle_back_note = null;
    if (!current.responded_at && !Object.prototype.hasOwnProperty.call(body, "responded_at")) {
      updates.responded_at = new Date().toISOString();
      updates.next_action = null;
      updates.next_follow_up_at = null;
      updates.follow_up_step = 0;
    } else if (current.next_action === "circle_back" || current.circle_back_at) {
      updates.next_action = null;
      updates.next_follow_up_at = null;
    }
  }

  if (normalized === "ghost" || normalized === "closed") {
    updates.circle_back_at = null;
    updates.circle_back_note = null;
  }

  if (normalized === "target" && current.pipeline_stage === "ghost") {
    Object.assign(updates, resetCadenceOnReengage());
  }

  return updates;
}

export function buildCadenceTouchUpdates(
  current: CadenceFields & { pipeline_stage: string },
  body: Record<string, unknown>
): Record<string, unknown> | null {
  const channel = String(body.channel ?? "").trim() as "email" | "linkedin" | "call";
  if (!["email", "linkedin", "call"].includes(channel)) return null;
  const outcome = body.outcome != null ? String(body.outcome) : null;
  const draft_id = body.draft_id != null ? String(body.draft_id) : null;
  const patch = applyCadenceTouch(current, { channel, outcome, draft_id });
  if (!patch) return null;
  const updates: Record<string, unknown> = { ...patch };
  if (patch.pipeline_stage) {
    updates.funnel_stage = pipelineStageToFunnel(normalizePipelineStage(String(patch.pipeline_stage)));
  }
  return updates;
}

export function buildCadenceDueUpdates(current: CadenceFields): Record<string, unknown> | null {
  const patch = processCadenceDue(current);
  if (!patch) return null;
  const updates: Record<string, unknown> = { ...patch };
  if (patch.pipeline_stage) {
    updates.funnel_stage = pipelineStageToFunnel(normalizePipelineStage(String(patch.pipeline_stage)));
  }
  return updates;
}
