import {
  AIFlowIntent,
  classifyFlowIntent,
  detectFlow5MultiCompanyTemplateIntent,
  userReplyingAfterInterestCategoryPrompt,
} from "@/lib/ai/flow-intent";
import { detectEmailRevisionIntent } from "@/lib/ai/email-revision-intent";
import {
  extractLatestCuratePitchInterestsFromMessages,
  getPitchAutoConfirmAddon,
  resolveAutoConfirmedInterests,
  shouldAutoConfirmPitchInterests,
} from "@/lib/ai/pitch-auto-interests";
import { parseEmailThreadContext } from "@/lib/ai/email-thread-context";
import {
  getEmailRoutingContextAddon,
  resolveEmailRoutingContext,
} from "@/lib/ai/email-routing-context";
import {
  getEmailInterestSelectionPromptAddon,
  getEmailRevisionModeAddon,
  getFlow1InterestSelectionGateAddon,
  getFlow4InterestSelectionGateAddon,
  getFlow5InterestSelectionGateAddon,
  getFlow6InterestSelectionGateAddon,
  getFlow7InterestSelectionGateAddon,
  getFlowSystemPromptAddon,
  getPostInterestSelectionComposeAddon,
} from "@/lib/ai/flow-guards";
import {
  ApprovedInterestCategory,
  extractApprovedInterestSelections,
} from "@/lib/ai/interest-taxonomy";

type BuildFlowContextInput = {
  trimmedMessages: any[];
  pipelineDrafting: boolean;
  sessionContextText?: string | null;
  /** Interests from ask_user_question interaction_response (client may not include them in messages yet). */
  interactionSelectedInterests?: ApprovedInterestCategory[];
  forceComposeAfterInterests?: boolean;
};

export type AIChatFlowContext = {
  flowIntent: AIFlowIntent;
  selectedInterests: ApprovedInterestCategory[];
  flowPromptAddon: string;
  interestGateAddons: string;
  emailInterestAddon: string;
  emailRevisionMode: boolean;
  emailRoutingAddon: string;
  emailRoutingShouldClarify: boolean;
  skipInterestPicker: boolean;
  composeAfterInterestSelection: boolean;
};

export function buildAIChatFlowContext(input: BuildFlowContextInput): AIChatFlowContext {
  const { trimmedMessages, pipelineDrafting, sessionContextText } = input;
  const forceComposeAfterInterests = input.forceComposeAfterInterests === true;
  const emailRouting = resolveEmailRoutingContext({
    messages: trimmedMessages,
    pipelineDrafting,
    sessionContextText,
  });

  let flowIntent = classifyFlowIntent(trimmedMessages, { pipelineDrafting });
  if (
    emailRouting.confidence === "high" &&
    emailRouting.flow_intent &&
    (emailRouting.is_revision || emailRouting.athlete_count >= 2)
  ) {
    flowIntent = emailRouting.flow_intent;
  }

  const selectedInterestsFromUsers: ApprovedInterestCategory[] = [];
  for (const m of trimmedMessages) {
    if (m?.role !== "user") continue;
    const picks = extractApprovedInterestSelections(String(m?.content ?? ""));
    for (const p of picks) selectedInterestsFromUsers.push(p);
  }
  const selectedInterests: ApprovedInterestCategory[] = [...new Set(selectedInterestsFromUsers)];

  const emailRevisionMode = detectEmailRevisionIntent(trimmedMessages);
  const emailThreadContext = parseEmailThreadContext(trimmedMessages);
  const threadInterests = emailThreadContext.selected_interests as ApprovedInterestCategory[];
  for (const p of threadInterests) {
    if (!selectedInterests.includes(p)) selectedInterests.push(p);
  }
  for (const pick of input.interactionSelectedInterests ?? []) {
    if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
  }

  const curationFromThread = extractLatestCuratePitchInterestsFromMessages(trimmedMessages);
  const autoConfirmedFromThread =
    selectedInterests.length === 0 &&
    curationFromThread &&
    shouldAutoConfirmPitchInterests(curationFromThread, { pipelineDrafting })
      ? resolveAutoConfirmedInterests(curationFromThread)
      : [];
  for (const pick of autoConfirmedFromThread) {
    if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
  }

  const skipInterestPicker = autoConfirmedFromThread.length > 0;
  const autoConfirmAddon = getPitchAutoConfirmAddon(autoConfirmedFromThread);

  const flow5MultiCompany = detectFlow5MultiCompanyTemplateIntent(trimmedMessages, { pipelineDrafting });
  const afterInterestPrompt = userReplyingAfterInterestCategoryPrompt(trimmedMessages);

  const flow1InterestGate =
    !emailRevisionMode &&
    flowIntent === "inbound_company_athlete_match" &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow1InterestSelectionGateAddon()
      : "";

  const flow5InterestGate =
    !emailRevisionMode &&
    !skipInterestPicker &&
    flowIntent === "email_single_athlete" &&
    flow5MultiCompany &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow5InterestSelectionGateAddon()
      : "";

  const flow4InterestGate =
    !emailRevisionMode &&
    !skipInterestPicker &&
    flowIntent === "email_single_athlete" &&
    !flow5MultiCompany &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow4InterestSelectionGateAddon()
      : "";

  const flow6InterestGate =
    !emailRevisionMode &&
    !skipInterestPicker &&
    flowIntent === "email_group_outreach" &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow6InterestSelectionGateAddon()
      : "";

  const flow7InterestGate =
    !emailRevisionMode &&
    !skipInterestPicker &&
    flowIntent === "email_roster_outreach" &&
    selectedInterests.length === 0 &&
    !afterInterestPrompt
      ? getFlow7InterestSelectionGateAddon()
      : "";

  const revisionAddon = emailRevisionMode
    ? getEmailRevisionModeAddon({
        company_name: emailThreadContext.company_name,
        athlete_ids: emailThreadContext.athlete_ids,
        athlete_names: emailThreadContext.athlete_names,
        selected_interests: selectedInterests,
      })
    : "";

  const routingAddon =
    !emailRouting.should_clarify ? getEmailRoutingContextAddon(emailRouting) : "";

  const composeAfterInterestSelection =
    !emailRevisionMode &&
    selectedInterests.length > 0 &&
    (forceComposeAfterInterests || skipInterestPicker || afterInterestPrompt);

  const postInterestComposeAddon =
    composeAfterInterestSelection ? getPostInterestSelectionComposeAddon(selectedInterests, flowIntent) : "";

  const flowPromptAddon = [getFlowSystemPromptAddon(flowIntent), revisionAddon, routingAddon, autoConfirmAddon, postInterestComposeAddon]
    .filter(Boolean)
    .join("\n\n");
  const emailInterestAddon =
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach"
      ? getEmailInterestSelectionPromptAddon(selectedInterests, flowIntent)
      : "";

  const interestGateAddons = [flow1InterestGate, flow4InterestGate, flow5InterestGate, flow6InterestGate, flow7InterestGate]
    .filter(Boolean)
    .join("");

  return {
    flowIntent,
    selectedInterests,
    flowPromptAddon,
    interestGateAddons,
    emailInterestAddon,
    emailRevisionMode,
    emailRoutingAddon: routingAddon,
    emailRoutingShouldClarify: emailRouting.should_clarify,
    skipInterestPicker,
    composeAfterInterestSelection,
  };
}
