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

export const STAGES: { id: PipelineStage; label: string; columnClass?: string }[] = [
  { id: "target", label: "Target" },
  { id: "research", label: "Research" },
  { id: "drafting", label: "Drafting" },
  { id: "outreach", label: "Outreach" },
  { id: "bounced", label: "Bounced", columnClass: "border-l-4 border-orange-400/80" },
  { id: "follow_up", label: "Follow-Up", columnClass: "border-l-4 border-amber-300" },
  { id: "ghost", label: "Ghost", columnClass: "border-l-4 border-red-300/80" },
  { id: "in_progress", label: "In Progress" },
  { id: "closed", label: "Closed", columnClass: "border-l-4 border-green-400" },
];

export const STAGE_LABEL: Record<PipelineStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.label])
) as Record<PipelineStage, string>;
