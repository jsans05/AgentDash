import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedToolsForFlowMode,
  classifyFlowModeBucket,
  flowIntentFromMode,
  interestPickerAllowed,
  resolveFlowMode,
} from "@/lib/ai/flow-mode";
import { getMissingRequiredTools } from "@/lib/ai/flow-guards";
import { buildSystemPrompt, filterToolDefinitions } from "@/lib/ai/prompts";

test("resolveFlowMode prefers explicit outbound over auto classification", () => {
  assert.equal(
    resolveFlowMode({
      flowMode: "outbound",
      messages: [{ role: "user", content: "find athletes for Nike" }],
    }),
    "outbound"
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

test("resolveFlowMode defaults target_list + athlete to outbound", () => {
  assert.equal(
    resolveFlowMode({
      uiContext: "target_list",
      athleteId: "athlete-uuid",
      messages: [],
    }),
    "outbound"
  );
});

test("classifyFlowModeBucket inbound company requests", () => {
  assert.equal(
    classifyFlowModeBucket([{ role: "user", content: "find athletes for Nike" }]),
    "inbound"
  );
});

test("classifyFlowModeBucket outbound athlete requests", () => {
  assert.equal(
    classifyFlowModeBucket([{ role: "user", content: "who should we pitch for Jordan?" }], {
      athleteId: "a",
    }),
    "outbound"
  );
});

test("flowIntentFromMode maps modes to intents", () => {
  assert.equal(flowIntentFromMode("outbound"), "company_targets");
  assert.equal(flowIntentFromMode("inbound"), "inbound_company_athlete_match");
  assert.equal(flowIntentFromMode("email"), "email_single_athlete");
});

test("interestPickerAllowed by mode", () => {
  assert.equal(interestPickerAllowed("default"), false);
  assert.equal(interestPickerAllowed("outbound"), false);
  assert.equal(interestPickerAllowed("inbound"), true);
  assert.equal(interestPickerAllowed("email"), true);
});

test("default mode has no blocked tools", () => {
  assert.equal(blockedToolsForFlowMode("default").size, 0);
  const tools = [
    { function: { name: "composePitchEmail" } },
    { function: { name: "generateAthleteProspectList" } },
    { function: { name: "searchAthletesByAudienceMatch" } },
  ];
  assert.equal(filterToolDefinitions(tools, "default").length, 3);
});

test("getMissingRequiredTools default mode requires no mandatory tools", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), { flowMode: "default" });
  assert.deepEqual(missing, []);
  const inboundMissing = getMissingRequiredTools("inbound_company_athlete_match", new Set(), {
    flowMode: "default",
  });
  assert.deepEqual(inboundMissing, []);
});

test("buildSystemPrompt default uses minimal guardrails module", () => {
  const prompt = buildSystemPrompt({
    role: "admin",
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
    flowMode: "default",
  });
  assert.match(prompt, /DEFAULT MODE/);
  assert.doesNotMatch(prompt, /ACTIVE MODE: OUTBOUND/);
  assert.doesNotMatch(prompt, /ACTIVE MODE: EMAIL/);
});

test("getMissingRequiredTools outbound requires prospect tools", () => {
  const missing = getMissingRequiredTools("company_targets", new Set(), { flowMode: "outbound" });
  assert.deepEqual(missing, ["getSponsorshipTargets", "generateAthleteProspectList"]);
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

test("buildSystemPrompt outbound excludes email flow instructions", () => {
  const prompt = buildSystemPrompt({
    role: "admin",
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
    flowMode: "outbound",
  });
  assert.match(prompt, /ACTIVE MODE: OUTBOUND/);
  assert.doesNotMatch(prompt, /FLOW 4: INDIVIDUAL OUTREACH EMAIL/);
  assert.doesNotMatch(prompt, /searchAthletesByAudienceMatch/);
});

test("buildSystemPrompt email includes email flows", () => {
  const prompt = buildSystemPrompt({
    role: "admin",
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
    flowMode: "email",
  });
  assert.match(prompt, /ACTIVE MODE: EMAIL/);
  assert.match(prompt, /FLOW 4: INDIVIDUAL OUTREACH EMAIL/);
});

test("filterToolDefinitions outbound blocks composePitchEmail", () => {
  const tools = [
    { function: { name: "composePitchEmail" } },
    { function: { name: "generateAthleteProspectList" } },
  ];
  const filtered = filterToolDefinitions(tools, "outbound");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.function?.name, "generateAthleteProspectList");
});

test("blockedToolsForFlowMode email blocks generateAthleteProspectList", () => {
  assert.ok(blockedToolsForFlowMode("email").has("generateAthleteProspectList"));
});
