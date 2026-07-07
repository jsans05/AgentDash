import type { AIFlowIntent } from "@/lib/ai/flow-intent";
import { getBulkImportPrompt } from "@/lib/ai/prompts/bulk-import";
import { getEmailPrompt } from "@/lib/ai/prompts/email";
import { getInboundPrompt } from "@/lib/ai/prompts/inbound";
import { getOutboundPrompt } from "@/lib/ai/prompts/outbound";

/** One intent-selected playbook per turn (replaces always-on mode prompts). */
export function getPlaybookForIntent(
  flowIntent: AIFlowIntent,
  options: { senderDisplayName: string; sportsListNumbered: string; includeBulkImport?: boolean }
): string {
  if (options.includeBulkImport) {
    return getBulkImportPrompt();
  }

  switch (flowIntent) {
    case "company_targets":
      return getOutboundPrompt();
    case "inbound_company_athlete_match":
      return getInboundPrompt(options.sportsListNumbered);
    case "email_single_athlete":
    case "email_group_outreach":
    case "email_roster_outreach":
    case "email_general_outreach":
      return getEmailPrompt(options.senderDisplayName);
    case "general":
    default:
      return "";
  }
}
