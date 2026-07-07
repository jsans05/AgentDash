import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import { classifyFlowIntent } from "@/lib/ai/flow-intent";

/** Mystery Machine task mode — sets rails before the first user message. */
export type FlowMode = "outbound" | "inbound" | "email" | "auto";

export type ExplicitFlowMode = Exclude<FlowMode, "auto">;

/** Server-resolved mode: explicit modes or default (minimal guardrails). */
export type ResolvedFlowMode = ExplicitFlowMode | "default";

export type FlowModeResolutionInput = {
  flowMode?: FlowMode | null;
  /** Persisted on ai_conversations when request omits flow_mode. */
  conversationFlowMode?: FlowMode | null;
  pipelineDrafting?: boolean;
  uiContext?: "target_list" | "consulting_target_list" | "master_target_list" | "crm_pipeline" | "global" | null;
  athleteId?: string | null;
  messages?: any[];
};

export type ClassifyFlowIntentOptions = {
  pipelineDrafting?: boolean;
  athleteId?: string | null;
  targetListContext?: boolean;
};

const FLOW_MODE_VALUES: FlowMode[] = ["outbound", "inbound", "email", "auto"];

export function parseFlowMode(raw: unknown): FlowMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (FLOW_MODE_VALUES.includes(value as FlowMode)) return value as FlowMode;
  return undefined;
}

/** Map explicit mode to primary AIFlowIntent (email sub-classifies later). */
export function flowIntentFromMode(flowMode: ExplicitFlowMode): AIFlowIntent {
  switch (flowMode) {
    case "outbound":
      return "company_targets";
    case "inbound":
      return "inbound_company_athlete_match";
    case "email":
      return "email_single_athlete";
  }
}

/** Resolved mode is always default; specialization is intent + ui_context + playbooks. */
export function resolveFlowMode(_input: FlowModeResolutionInput): ResolvedFlowMode {
  return "default";
}

export type ResolveFlowIntentInput = ClassifyFlowIntentOptions & {
  /** Raw flow_mode from client (outbound/inbound/email/auto) — biases intent only. */
  explicitFlowMode?: FlowMode | null;
  conversationFlowMode?: FlowMode | null;
};

/** Resolve flow intent: explicit mode chips bias intent; otherwise classify from messages. */
export function resolveFlowIntentForMode(
  _flowMode: ResolvedFlowMode,
  messages: any[],
  options?: ResolveFlowIntentInput
): AIFlowIntent {
  const explicit =
    parseFlowMode(options?.explicitFlowMode) ??
    (() => {
      const persisted = parseFlowMode(options?.conversationFlowMode);
      return persisted && persisted !== "auto" ? persisted : undefined;
    })();

  if (explicit === "email" || options?.pipelineDrafting) {
    return classifyFlowIntent(messages, options);
  }
  if (explicit === "outbound" || explicit === "inbound") {
    return flowIntentFromMode(explicit);
  }
  return classifyFlowIntent(messages, options);
}

export function interestPickerAllowedForIntent(flowIntent: AIFlowIntent): boolean {
  return (
    flowIntent === "inbound_company_athlete_match" ||
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach" ||
    flowIntent === "email_general_outreach"
  );
}

/** @deprecated Mode-based tool blocking removed; ui_context blocking only. */
export function blockedToolsForFlowMode(_flowMode: ResolvedFlowMode): Set<string> {
  return new Set();
}
