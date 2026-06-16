import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import {
  classifyFlowIntent,
  detectCompanyTargetsIntent,
  detectInboundCompanyAthleteMatchIntent,
  detectEmailIntent,
  detectGeneralOutreachIntent,
  detectGroupOutreachIntent,
  detectRosterOutreachIntent,
} from "@/lib/ai/flow-intent";

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
  uiContext?: "target_list" | "crm_pipeline" | "global" | null;
  athleteId?: string | null;
  messages?: any[];
};

export type ClassifyFlowIntentOptions = {
  pipelineDrafting?: boolean;
  athleteId?: string | null;
};

const FLOW_MODE_VALUES: FlowMode[] = ["outbound", "inbound", "email", "auto"];

export function parseFlowMode(raw: unknown): FlowMode | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (FLOW_MODE_VALUES.includes(value as FlowMode)) return value as FlowMode;
  return undefined;
}

export function isExplicitFlowMode(mode: ResolvedFlowMode): mode is ExplicitFlowMode {
  return mode !== "default";
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

/** Resolve auto mode into outbound / inbound / email using message heuristics. */
export function classifyFlowModeBucket(
  messages: any[],
  options?: ClassifyFlowIntentOptions
): ExplicitFlowMode {
  const pipelineDrafting = options?.pipelineDrafting === true;

  if (detectRosterOutreachIntent(messages, pipelineDrafting)) return "email";
  if (detectGroupOutreachIntent(messages, pipelineDrafting)) return "email";
  if (detectGeneralOutreachIntent(messages)) return "email";
  if (detectEmailIntent(messages)) return "email";

  if (detectInboundCompanyAthleteMatchIntent(messages)) return "inbound";
  if (detectCompanyTargetsIntent(messages, options)) return "outbound";

  const text = latestUserText(messages);
  if (
    /\blet'?s prospect\b/.test(text) ||
    /\bprospect\b/.test(text) ||
    /\bfocus on\b.*\bcompanies\b/.test(text) ||
    (/\b(sponsors?|brands?|companies|targets)\b/.test(text) &&
      !/(draft|write|compose|email|template|send)\b/.test(text))
  ) {
    return "outbound";
  }

  if (
    /\bfind athletes?\b/.test(text) ||
    /\bwhich athletes?\b/.test(text) ||
    /who should (they|we) pitch to\b/.test(text) ||
    /looking to sponsor/.test(text)
  ) {
    return "inbound";
  }

  return "outbound";
}

export function resolveFlowMode(input: FlowModeResolutionInput): ResolvedFlowMode {
  const explicit = parseFlowMode(input.flowMode);
  if (explicit && explicit !== "auto") return explicit;

  const persisted = parseFlowMode(input.conversationFlowMode);
  if (persisted && persisted !== "auto") return persisted;

  if (input.pipelineDrafting) return "email";
  if (input.uiContext === "crm_pipeline") return "email";

  return "default";
}

/** Resolve flow intent: explicit modes win; default uses general classifier. */
export function resolveFlowIntentForMode(
  flowMode: ResolvedFlowMode,
  messages: any[],
  options?: ClassifyFlowIntentOptions
): AIFlowIntent {
  if (flowMode === "default") {
    return classifyFlowIntent(messages, options);
  }
  if (flowMode === "email") {
    return classifyFlowIntent(messages, options);
  }
  return flowIntentFromMode(flowMode);
}

export function interestPickerAllowed(flowMode: ResolvedFlowMode): boolean {
  return flowMode === "inbound" || flowMode === "email";
}

/** Tool names excluded from OpenAI tool schema per mode. */
export const OUTBOUND_BLOCKED_TOOLS = new Set([
  "composePitchEmail",
  "mergePitchEmails",
  "searchAthletesByAudienceMatch",
  "getDistinctAudienceInterests",
  "getRosterAudienceSummary",
]);

export const INBOUND_BLOCKED_TOOLS = new Set([
  "generateAthleteProspectList",
  "composePitchEmail",
  "mergePitchEmails",
  "getRosterAudienceSummary",
  "bulkImportCompaniesToCrmForAthlete",
]);

export const EMAIL_BLOCKED_TOOLS = new Set(["generateAthleteProspectList"]);

export function blockedToolsForFlowMode(flowMode: ResolvedFlowMode): Set<string> {
  if (flowMode === "default") return new Set();
  switch (flowMode) {
    case "outbound":
      return OUTBOUND_BLOCKED_TOOLS;
    case "inbound":
      return INBOUND_BLOCKED_TOOLS;
    case "email":
      return EMAIL_BLOCKED_TOOLS;
  }
}

function latestUserText(messages: any[]): string {
  const latestUser = [...messages]
    .reverse()
    .find((m: any) => m?.role === "user" && String(m?.content ?? "").trim());
  return String(latestUser?.content ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
