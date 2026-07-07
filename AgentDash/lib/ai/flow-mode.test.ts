import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedToolsForFlowMode,
  flowIntentFromMode,
  interestPickerAllowedForIntent,
  resolveFlowMode,
  resolveFlowIntentForMode,
} from "@/lib/ai/flow-mode";
import {
  assistantClaimsTargetListSave,
  assistantHasPresentableOutreachDraft,
  getFlowIntentRoutingAddon,
  getMissingRequiredTools,
} from "@/lib/ai/flow-guards";
import { buildSystemPrompt, filterToolDefinitions } from "@/lib/ai/prompts";

test.beforeEach(() => {
  delete process.env.FLOW_MODE_ENFORCEMENT;
});

test("resolveFlowMode always resolves to default", () => {
  assert.equal(
    resolveFlowMode({
      flowMode: "outbound",
      messages: [{ role: "user", content: "find athletes for Nike" }],
    }),
    "default"
  );
  assert.equal(
    resolveFlowMode({
      pipelineDrafting: true,
      uiContext: "crm_pipeline",
    }),
    "default"
  );
});

test("resolveFlowMode auto with no messages resolves to default", () => {
  assert.equal(
    resolveFlowMode({
      flowMode: "auto",
      messages: [],
    }),
    "default"
  );
});

test("resolveFlowMode defaults target_list + athlete to default (intent-based)", () => {
  assert.equal(
    resolveFlowMode({
      uiContext: "target_list",
      athleteId: "athlete-uuid",
      messages: [],
    }),
    "default"
  );
});

test("flowIntentFromMode maps modes to intents", () => {
  assert.equal(flowIntentFromMode("outbound"), "company_targets");
  assert.equal(flowIntentFromMode("inbound"), "inbound_company_athlete_match");
  assert.equal(flowIntentFromMode("email"), "email_single_athlete");
});

test("resolveFlowIntentForMode honors explicit outbound mode chip", () => {
  assert.equal(
    resolveFlowIntentForMode("default", [{ role: "user", content: "hello" }], {
      explicitFlowMode: "outbound",
    }),
    "company_targets"
  );
});

test("interestPickerAllowedForIntent by intent", () => {
  assert.equal(interestPickerAllowedForIntent("general"), false);
  assert.equal(interestPickerAllowedForIntent("company_targets"), false);
  assert.equal(interestPickerAllowedForIntent("inbound_company_athlete_match"), true);
  assert.equal(interestPickerAllowedForIntent("email_single_athlete"), true);
});

test("blockedToolsForFlowMode is always empty (ui_context blocks only)", () => {
  assert.equal(blockedToolsForFlowMode("default").size, 0);
  assert.equal(blockedToolsForFlowMode("email").size, 0);
  const tools = [
    { function: { name: "composePitchEmail" } },
    { function: { name: "generateAthleteProspectList" } },
    { function: { name: "searchAthletesByAudienceMatch" } },
  ];
  assert.equal(filterToolDefinitions(tools, "default").length, 3);
});

test("getMissingRequiredTools default mode enforces intent-based outbound tools", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), { flowMode: "default" });
  assert.deepEqual(missing, ["getSponsorshipTargets", "generateAthleteProspectList"]);
  const inboundMissing = getMissingRequiredTools("inbound_company_athlete_match", new Set(), {
    flowMode: "default",
  });
  assert.deepEqual(inboundMissing, ["getDistinctAudienceInterests"]);
});

test("getFlowIntentRoutingAddon returns inbound routing for company-athlete match", () => {
  const addon = getFlowIntentRoutingAddon("inbound_company_athlete_match");
  assert.match(addon, /searchAthletesByAudienceMatch/);
  assert.match(addon, /Do NOT call curatePitchInterests/);
});

test("getMissingRequiredTools default email fan-out requires batched pushEmailToCrm", () => {
  const missing = getMissingRequiredTools(
    "email_single_athlete",
    new Set(["composePitchEmail", "curatePitchInterests"]),
    {
      flowMode: "default",
      selectedInterestsCount: 2,
      composePitchEmailCallCount: 3,
    }
  );
  assert.ok(missing.includes("pushEmailToCrm"));
});

test("buildSystemPrompt uses default mode header only", () => {
  const prompt = buildSystemPrompt({
    role: "admin",
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
    flowMode: "default",
  });
  assert.match(prompt, /DEFAULT MODE/);
  assert.doesNotMatch(prompt, /ACTIVE MODE: OUTBOUND/);
  assert.match(prompt, /CRM PIPELINE DRAFTING/);
});

test("buildSystemPrompt ignores legacy outbound flowMode param", () => {
  const prompt = buildSystemPrompt({
    role: "admin",
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
    flowMode: "outbound",
  });
  assert.match(prompt, /DEFAULT MODE/);
  assert.doesNotMatch(prompt, /ACTIVE MODE: OUTBOUND/);
});

test("getMissingRequiredTools skips prospect tools when targetListSaveIntent is active", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), {
    flowMode: "outbound",
    targetListSaveIntent: true,
  });
  assert.deepEqual(missing, []);
});

test("getMissingRequiredTools outbound requires prospect tools", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), { flowMode: "outbound" });
  assert.deepEqual(missing, ["getSponsorshipTargets", "generateAthleteProspectList"]);
});

test("getMissingRequiredTools target list without explicit prospect skips prospect tools", () => {
  const missing = getMissingRequiredTools(
    "company_targets",
    new Set(["getSponsorshipTargets"]),
    {
      flowMode: "default",
      targetListContext: true,
      explicitProspectIntent: false,
    }
  );
  assert.deepEqual(missing, []);
});

test("getMissingRequiredTools target list with explicit prospect still requires prospect list", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), {
    flowMode: "default",
    targetListContext: true,
    explicitProspectIntent: true,
  });
  assert.deepEqual(missing, ["getSponsorshipTargets", "generateAthleteProspectList"]);
});

test("filterToolDefinitions blocks generateAthleteProspectList via blockedExtra", () => {
  const tools = [
    { function: { name: "composePitchEmail" } },
    { function: { name: "generateAthleteProspectList" } },
    { function: { name: "getSponsorshipTargets" } },
  ];
  const filtered = filterToolDefinitions(
    tools,
    "default",
    new Set(["generateAthleteProspectList"])
  );
  assert.equal(filtered.length, 2);
  assert.ok(!filtered.some((t) => t.function?.name === "generateAthleteProspectList"));
});

test("assistantHasPresentableOutreachDraft accepts standard email draft", () => {
  const draft = `Subject: Hunter x Brand

Hi there,

Hope you are well.

Looking forward to hearing from you,`;
  assert.equal(assistantHasPresentableOutreachDraft(draft), true);
});

test("assistantHasPresentableOutreachDraft accepts outreach without Subject line", () => {
  const draft = `Hope you're well — nice to meet you!

I'm reaching out on behalf of Hunter Lawrence.

Looking forward to hearing from you,`;
  assert.equal(assistantHasPresentableOutreachDraft(draft), true);
});

test("assistantClaimsTargetListSave ignores permission asks", () => {
  assert.equal(
    assistantClaimsTargetListSave("Shall I save this to the target list now?"),
    false
  );
});

test("assistantClaimsTargetListSave detects false save claims", () => {
  assert.equal(
    assistantClaimsTargetListSave("Saved the outreach email to Hunter's target list."),
    true
  );
  assert.equal(
    assistantClaimsTargetListSave("✅ Saved! The email has been updated on Hunter's Target List."),
    true
  );
});

test("getMissingRequiredTools target list skips pipeline when draft already shown", () => {
  const draft = `Subject: Test

Hi,

Hope you are well.

Looking forward to hearing from you,`;
  const missing = getMissingRequiredTools("email_single_athlete", new Set(), {
    flowMode: "default",
    targetListContext: true,
    explicitProspectIntent: false,
    lastAssistantContent: draft,
    selectedInterestsCount: 0,
  });
  assert.deepEqual(missing, []);
});

test("getMissingRequiredTools inbound requires interest catalog first", () => {
  const missing = getMissingRequiredTools("inbound_company_athlete_match", new Set(), {
    flowMode: "inbound",
  });
  assert.deepEqual(missing, ["getDistinctAudienceInterests"]);
});

test("getMissingRequiredTools skips compose when assistant asked a clarifying question", () => {
  const missing = getMissingRequiredTools("email_single_athlete", new Set(), {
    flowMode: "email",
    selectedInterestsCount: 2,
    composeAfterInterestSelection: true,
    lastAssistantContent: "Which Jamie did you mean — Jamie Smith or Jamie Lee?",
  });
  assert.deepEqual(missing, []);
});

test("getMissingRequiredTools still requires compose after picks when assistant did not ask", () => {
  const missing = getMissingRequiredTools("email_single_athlete", new Set(), {
    flowMode: "email",
    selectedInterestsCount: 2,
    composeAfterInterestSelection: true,
    lastAssistantContent: "I'll draft the email next.",
  });
  assert.deepEqual(missing, ["composePitchEmail"]);
});
