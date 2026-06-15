import { getFlowModeEnforcement } from "@/lib/ai/feature-flags";
import {
  blockedToolsForFlowMode,
  type ResolvedFlowMode,
} from "@/lib/ai/flow-mode";
import { getBasePrompt } from "@/lib/ai/prompts/base";
import { getBulkImportPrompt } from "@/lib/ai/prompts/bulk-import";
import { getDefaultPrompt } from "@/lib/ai/prompts/default";
import { getEmailPrompt } from "@/lib/ai/prompts/email";
import { getInboundPrompt } from "@/lib/ai/prompts/inbound";
import { getOutboundPrompt } from "@/lib/ai/prompts/outbound";
import { getSharedRulesPrompt } from "@/lib/ai/prompts/shared-rules";

export type BuildSystemPromptInput = {
  role: string;
  senderDisplayName: string;
  sportsListNumbered: string;
  flowMode: ResolvedFlowMode;
  includeBulkImport?: boolean;
};

const SCHEMA_MODE_HEADERS: Record<Exclude<ResolvedFlowMode, "default">, string> = {
  outbound: `
━━━ ACTIVE MODE: OUTBOUND (find companies to sponsor athlete(s)) ━━━
You are in **Outbound** mode. Find sponsor brands/companies for athlete(s).
- Use getSponsorshipTargets + generateAthleteProspectList — never hand-build prospect tables.
- NEVER call getDistinctAudienceInterests or ask_user_question for IG audience interest categories in this mode.
- If no athlete is named, call listAthletesScoped or ask_user_question with athlete names (not interest categories).
`.trim(),
  inbound: `
━━━ ACTIVE MODE: INBOUND (find athletes to pitch to a company) ━━━
You are in **Inbound** mode. A company/brand wants to sponsor — find matching roster athletes.
- Follow the 3-step flow: interest categories → sports → searchAthletesByAudienceMatch.
- "Who should we pitch to [company]" is inbound; do NOT suggest companies to target.
`.trim(),
  email: `
━━━ ACTIVE MODE: EMAIL (draft outreach copy) ━━━
You are in **Email** mode. Draft outreach emails using curatePitchInterests → interest picker → composePitchEmail.
- Do NOT call generateAthleteProspectList unless the user explicitly switches to outbound prospecting.
`.trim(),
};

const ADVISORY_MODE_HEADERS: Record<Exclude<ResolvedFlowMode, "default">, string> = {
  outbound: `
━━━ User-stated focus: prospecting (find sponsors for athletes). The user can pivot mid-conversation. ━━━
- Use getSponsorshipTargets + generateAthleteProspectList — never hand-build prospect tables.
- NEVER call getDistinctAudienceInterests or ask_user_question for IG audience interest categories in this mode.
- If no athlete is named, call listAthletesScoped or ask_user_question with athlete names (not interest categories).
`.trim(),
  inbound: `
━━━ User-stated focus: inbound matching (find athletes for a company). The user can pivot mid-conversation. ━━━
- Follow the 3-step flow: interest categories → sports → searchAthletesByAudienceMatch.
- "Who should we pitch to [company]" is inbound; do NOT suggest companies to target.
`.trim(),
  email: `
━━━ User-stated focus: outreach drafting. The user can pivot mid-conversation. ━━━
- Draft outreach emails using curatePitchInterests → interest picker → composePitchEmail.
- Do NOT call generateAthleteProspectList unless the user explicitly switches to outbound prospecting.
`.trim(),
};

function modeHeaderFor(flowMode: Exclude<ResolvedFlowMode, "default">): string {
  const enforcement = getFlowModeEnforcement();
  return enforcement === "advisory" ? ADVISORY_MODE_HEADERS[flowMode] : SCHEMA_MODE_HEADERS[flowMode];
}

export function getModePrompt(input: BuildSystemPromptInput): string {
  const enforcement = getFlowModeEnforcement();
  const { flowMode, senderDisplayName, sportsListNumbered } = input;
  if (enforcement === "off" || flowMode === "default") {
    return getDefaultPrompt();
  }
  switch (flowMode) {
    case "outbound":
      return `${modeHeaderFor("outbound")}\n\n${getOutboundPrompt()}`;
    case "inbound":
      return `${modeHeaderFor("inbound")}\n\n${getInboundPrompt(sportsListNumbered)}`;
    case "email":
      return `${modeHeaderFor("email")}\n\n${getEmailPrompt(senderDisplayName)}`;
  }
}

export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const parts = [
    getBasePrompt(input.role),
    getModePrompt(input),
    getSharedRulesPrompt(),
  ];
  if (input.includeBulkImport) {
    parts.splice(2, 0, getBulkImportPrompt());
  }
  return parts.filter(Boolean).join("\n\n");
}

export function filterToolDefinitions<T extends { function?: { name?: string } }>(
  tools: T[],
  flowMode: ResolvedFlowMode,
  blockedExtra?: Set<string>
): T[] {
  const enforcement = getFlowModeEnforcement();
  if (enforcement === "schema") {
    const blocked = blockedToolsForFlowMode(flowMode);
    if (blockedExtra) {
      for (const name of blockedExtra) blocked.add(name);
    }
    return tools.filter((t) => {
      const name = String(t?.function?.name ?? "").trim();
      return name && !blocked.has(name);
    });
  }

  if (blockedExtra?.size) {
    return tools.filter((t) => {
      const name = String(t?.function?.name ?? "").trim();
      return name && !blockedExtra.has(name);
    });
  }
  return tools;
}
