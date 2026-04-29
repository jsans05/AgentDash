import {
  AIFlowIntent,
  classifyFlowIntent,
  detectFlow5MultiCompanyTemplateIntent,
  userReplyingAfterInterestCategoryPrompt,
} from "@/lib/ai/flow-intent";
import {
  getEmailInterestSelectionPromptAddon,
  getFlow4InterestSelectionGateAddon,
  getFlow5InterestSelectionGateAddon,
  getFlow6InterestSelectionGateAddon,
  getFlow7InterestSelectionGateAddon,
  getFlowSystemPromptAddon,
} from "@/lib/ai/flow-guards";
import {
  ApprovedInterestCategory,
  extractApprovedInterestSelections,
} from "@/lib/ai/interest-taxonomy";

type BuildFlowContextInput = {
  trimmedMessages: any[];
  pipelineDrafting: boolean;
};

export type AIChatFlowContext = {
  flowIntent: AIFlowIntent;
  selectedInterests: ApprovedInterestCategory[];
  flowPromptAddon: string;
  interestGateAddons: string;
  emailInterestAddon: string;
};

export function buildAIChatFlowContext(input: BuildFlowContextInput): AIChatFlowContext {
  const { trimmedMessages, pipelineDrafting } = input;
  const flowIntent = classifyFlowIntent(trimmedMessages, { pipelineDrafting });

  const selectedInterestsFromUsers: ApprovedInterestCategory[] = [];
  for (const m of trimmedMessages) {
    if (m?.role !== "user") continue;
    const picks = extractApprovedInterestSelections(String(m?.content ?? ""));
    for (const p of picks) selectedInterestsFromUsers.push(p);
  }
  const selectedInterests: ApprovedInterestCategory[] = [...new Set(selectedInterestsFromUsers)];

  const flow5MultiCompany = detectFlow5MultiCompanyTemplateIntent(trimmedMessages, { pipelineDrafting });
  const afterInterestPrompt = userReplyingAfterInterestCategoryPrompt(trimmedMessages);

  const flow5InterestGate =
    flowIntent === "email_single_athlete" &&
    flow5MultiCompany &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow5InterestSelectionGateAddon()
      : "";

  const flow4InterestGate =
    flowIntent === "email_single_athlete" &&
    !flow5MultiCompany &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow4InterestSelectionGateAddon()
      : "";

  const flow6InterestGate =
    flowIntent === "email_group_outreach" && selectedInterests.length === 0 && !afterInterestPrompt
      ? getFlow6InterestSelectionGateAddon()
      : "";

  const flow7InterestGate =
    flowIntent === "email_roster_outreach" && selectedInterests.length === 0 && !afterInterestPrompt
      ? getFlow7InterestSelectionGateAddon()
      : "";

  const flowPromptAddon = getFlowSystemPromptAddon(flowIntent);
  const emailInterestAddon =
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach"
      ? getEmailInterestSelectionPromptAddon(selectedInterests, flowIntent)
      : "";

  const interestGateAddons = [flow4InterestGate, flow5InterestGate, flow6InterestGate, flow7InterestGate]
    .filter(Boolean)
    .join("");

  return {
    flowIntent,
    selectedInterests,
    flowPromptAddon,
    interestGateAddons,
    emailInterestAddon,
  };
}
