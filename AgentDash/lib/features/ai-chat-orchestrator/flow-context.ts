import {
  AIFlowIntent,
  classifyFlowIntent,
  userReplyingAfterInterestCategoryPrompt,
} from "@/lib/ai/flow-intent";
import { detectEmailRevisionIntent } from "@/lib/ai/email-revision-intent";
import {
  extractLatestCuratePitchInterestsFromMessages,
  getPitchAutoConfirmAddon,
  resolveAutoConfirmedPitchSelection,
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
  getFlowIntentRoutingAddon,
  getPostInterestSelectionComposeAddon,
} from "@/lib/ai/flow-guards";
import {
  interestPickerAllowed,
  resolveFlowIntentForMode,
  type ResolvedFlowMode,
} from "@/lib/ai/flow-mode";
import {
  APPROVED_INTEREST_CATEGORIES,
  ApprovedInterestCategory,
  extractApprovedInterestSelections,
} from "@/lib/ai/interest-taxonomy";
import {
  extractUserStatedPitchAngles,
  getUserStatedAnglesAddon,
} from "@/lib/ai/user-stated-pitch-angles";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import { pitchAnglesToInterestNames } from "@/lib/ai/pitch-angle-id";

type BuildFlowContextInput = {
  trimmedMessages: any[];
  pipelineDrafting: boolean;
  sessionContextText?: string | null;
  flowMode: ResolvedFlowMode;
  athleteId?: string | null;
  /** Interests from ask_user_question interaction_response (client may not include them in messages yet). */
  interactionSelectedInterests?: ApprovedInterestCategory[];
  /** Multi-dimensional picker selections from ask_user_question. */
  interactionSelectedPitchAngles?: PitchAngle[];
  forceComposeAfterInterests?: boolean;
};

export type AIChatFlowContext = {
  flowMode: ResolvedFlowMode;
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
  userStatedAnglesAddon: string;
  userStatedPitchAngles: PitchAngle[];
  interactionSelectedPitchAngles: PitchAngle[];
};

export function buildAIChatFlowContext(input: BuildFlowContextInput): AIChatFlowContext {
  const { trimmedMessages, pipelineDrafting, sessionContextText, flowMode } = input;
  const forceComposeAfterInterests = input.forceComposeAfterInterests === true;
  const emailRouting = resolveEmailRoutingContext({
    messages: trimmedMessages,
    pipelineDrafting,
    sessionContextText,
  });

  let flowIntent = resolveFlowIntentForMode(flowMode, trimmedMessages, {
    pipelineDrafting,
    athleteId: input.athleteId,
  });
  if (
    flowMode === "email" &&
    emailRouting.confidence === "high" &&
    emailRouting.flow_intent &&
    (emailRouting.is_revision || emailRouting.athlete_count >= 2)
  ) {
    flowIntent = emailRouting.flow_intent;
  }

  const userStatedPitchAngles = extractUserStatedPitchAngles(trimmedMessages);

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
  const interactionSelectedPitchAngles = [...(input.interactionSelectedPitchAngles ?? [])];
  for (const pick of input.interactionSelectedInterests ?? []) {
    if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
  }
  for (const name of pitchAnglesToInterestNames(interactionSelectedPitchAngles)) {
    const pick = name as ApprovedInterestCategory;
    if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
  }

  const audiencePicksRecorded =
    selectedInterests.length > 0 ||
    interactionSelectedPitchAngles.length > 0 ||
    (input.interactionSelectedInterests?.length ?? 0) > 0;
  const applyUserStatedAngles =
    flowMode === "email" && userStatedPitchAngles.length > 0 && !audiencePicksRecorded;

  if (applyUserStatedAngles) {
    const approved = new Set<string>(APPROVED_INTEREST_CATEGORIES);
    for (const angle of userStatedPitchAngles) {
      if (angle.kind !== "interest") continue;
      if (!approved.has(angle.name)) continue;
      const pick = angle.name as ApprovedInterestCategory;
      if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
    }
  }

  const curationFromThread = extractLatestCuratePitchInterestsFromMessages(trimmedMessages);
  const autoConfirmedSelection =
    !applyUserStatedAngles &&
    selectedInterests.length === 0 &&
    curationFromThread &&
    shouldAutoConfirmPitchInterests(curationFromThread)
      ? resolveAutoConfirmedPitchSelection(curationFromThread)
      : { pitchAngles: [], interestNames: [] };
  for (const pick of autoConfirmedSelection.interestNames) {
    if (!selectedInterests.includes(pick)) selectedInterests.push(pick);
  }

  const skipInterestPicker =
    applyUserStatedAngles ||
    autoConfirmedSelection.pitchAngles.length > 0 ||
    autoConfirmedSelection.interestNames.length > 0;
  const userStatedAnglesAddon = applyUserStatedAngles
    ? getUserStatedAnglesAddon(userStatedPitchAngles)
    : "";
  const autoConfirmAddon = applyUserStatedAngles ? "" : getPitchAutoConfirmAddon(autoConfirmedSelection);
  const isAutoConfirmedCompose =
    (applyUserStatedAngles && userStatedAnglesAddon.length > 0) ||
    (skipInterestPicker && autoConfirmAddon.length > 0);

  const afterInterestPrompt = userReplyingAfterInterestCategoryPrompt(trimmedMessages);
  const allowInterestPicker =
    interestPickerAllowed(flowMode) ||
    flowIntent === "inbound_company_athlete_match" ||
    flowIntent === "email_single_athlete" ||
    flowIntent === "email_group_outreach" ||
    flowIntent === "email_roster_outreach" ||
    flowIntent === "email_general_outreach";

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

  const hasConfirmedAudienceSignals =
    selectedInterests.length > 0 ||
    interactionSelectedPitchAngles.length > 0 ||
    (applyUserStatedAngles && userStatedPitchAngles.length > 0) ||
    autoConfirmedSelection.pitchAngles.length > 0 ||
    autoConfirmedSelection.interestNames.length > 0;

  const composeAfterInterestSelection =
    allowInterestPicker &&
    !emailRevisionMode &&
    hasConfirmedAudienceSignals &&
    (forceComposeAfterInterests || skipInterestPicker || afterInterestPrompt);

  const postInterestComposeAddon =
    composeAfterInterestSelection && !isAutoConfirmedCompose
      ? getPostInterestSelectionComposeAddon(
          selectedInterests,
          flowIntent,
          interactionSelectedPitchAngles.length ? interactionSelectedPitchAngles : undefined
        )
      : "";

  const flowPromptAddon = [
    getFlowIntentRoutingAddon(flowIntent),
    revisionAddon,
    routingAddon,
    userStatedAnglesAddon,
    autoConfirmAddon,
    postInterestComposeAddon,
  ]
    .filter(Boolean)
    .join("\n\n");
  const emailInterestAddon =
    allowInterestPicker &&
    (flowIntent === "email_single_athlete" ||
      flowIntent === "email_group_outreach" ||
      flowIntent === "email_roster_outreach")
      ? getEmailInterestSelectionPromptAddon(selectedInterests, flowIntent)
      : "";

  const interestGateAddons = "";

  return {
    flowMode,
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
    userStatedAnglesAddon,
    userStatedPitchAngles: applyUserStatedAngles ? userStatedPitchAngles : [],
    interactionSelectedPitchAngles,
  };
}
