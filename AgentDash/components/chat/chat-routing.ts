import type { FlowMode } from "@/lib/ai/flow-mode";

export type ChatFlowMode = FlowMode;

export type ChatUiContext = "target_list" | "crm_pipeline" | "global";

/** Server flow_mode from embedded context or explicit URL param only — not user-toggled chips. */
export function deriveRoutingFlowMode(
  uiContext?: ChatUiContext,
  flowModeFromUrl?: ChatFlowMode
): ChatFlowMode | undefined {
  if (uiContext === "crm_pipeline") return "email";
  if (uiContext === "target_list") return undefined;
  if (flowModeFromUrl && flowModeFromUrl !== "auto") return flowModeFromUrl;
  return undefined;
}
