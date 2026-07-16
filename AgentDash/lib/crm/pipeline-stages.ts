export type PipelineStage =
  | "target"
  | "research"
  | "drafting"
  | "outreach"
  | "bounced"
  | "follow_up"
  | "ghost"
  | "in_progress"
  | "closed";

/** Kanban columns — `research` merged into `target` (legacy id normalized on read). */
export const STAGES: { id: PipelineStage; label: string; columnClass?: string }[] = [
  { id: "target", label: "Target Researched" },
  { id: "drafting", label: "Drafted" },
  { id: "outreach", label: "Send" },
  { id: "bounced", label: "Bounced", columnClass: "border-l-4 border-orange-400/80" },
  { id: "follow_up", label: "Follow-Up", columnClass: "border-l-4 border-amber-300" },
  { id: "ghost", label: "Ghost", columnClass: "border-l-4 border-red-300/80" },
  { id: "in_progress", label: "Negotiating" },
  { id: "closed", label: "Closed", columnClass: "border-l-4 border-green-400" },
];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  target: "Target Researched",
  research: "Target Researched",
  drafting: "Drafted",
  outreach: "Send",
  bounced: "Bounced",
  follow_up: "Follow-Up",
  ghost: "Ghost",
  in_progress: "Negotiating",
  closed: "Closed",
};

export function normalizeDisplayStage(stage: PipelineStage): PipelineStage {
  return stage === "research" ? "target" : stage;
}
