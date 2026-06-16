import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFlowIntent,
  detectCompanyTargetsIntent,
  detectExplicitProspectIntent,
  detectInboundCompanyAthleteMatchIntent,
  detectTargetListOutreachPushIntent,
  detectTargetListSaveAffirmativeIntent,
  detectTargetListSaveIntent,
} from "@/lib/ai/flow-intent";

test("detectInboundCompanyAthleteMatchIntent matches sponsor picking athletes", () => {
  const messages = [
    {
      role: "user",
      content:
        "I have a smaller eyewear company that is rugged oriented looking to sponsor one of our athletes. Who should they pick?",
    },
  ];
  assert.equal(detectInboundCompanyAthleteMatchIntent(messages), true);
  assert.equal(classifyFlowIntent(messages), "inbound_company_athlete_match");
});

test("detectCompanyTargetsIntent matches who should we pitch for athlete", () => {
  const messages = [{ role: "user", content: "Who should we pitch for Jordan?" }];
  assert.equal(detectCompanyTargetsIntent(messages), true);
  assert.equal(classifyFlowIntent(messages), "company_targets");
});

test("detectInboundCompanyAthleteMatchIntent matches pitch to company", () => {
  const messages = [{ role: "user", content: "Who should we pitch to Nike?" }];
  assert.equal(detectInboundCompanyAthleteMatchIntent(messages), true);
});

test("detectTargetListOutreachPushIntent requires target list phrase and email action", () => {
  assert.equal(
    detectTargetListOutreachPushIntent([
      { role: "user", content: "Push this email to the target list for Nike" },
    ]),
    true
  );
  assert.equal(
    detectTargetListOutreachPushIntent([
      { role: "user", content: "Save the outreach email to CRM pipeline" },
    ]),
    false
  );
});

test("detectTargetListSaveIntent matches outreach column without target list phrase", () => {
  assert.equal(
    detectTargetListSaveIntent([
      { role: "user", content: "Update the outreach email column for Adidas" },
    ]),
    true
  );
  assert.equal(
    detectTargetListSaveIntent([
      { role: "user", content: "Push this draft to the spreadsheet outreach fields" },
    ]),
    true
  );
  assert.equal(
    detectTargetListSaveIntent([{ role: "user", content: "What is NIL?" }]),
    false
  );
});

test("detectTargetListSaveIntent still matches explicit target list saves", () => {
  assert.equal(
    detectTargetListSaveIntent([
      { role: "user", content: "Save this email on his target list" },
    ]),
    true
  );
});

test("detectTargetListSaveAffirmativeIntent matches yes after save offer", () => {
  assert.equal(
    detectTargetListSaveAffirmativeIntent([
      { role: "assistant", content: "Want me to save this to Hunter's target list under Blenders Eyewear?" },
      { role: "user", content: "yes" },
    ]),
    true
  );
  assert.equal(
    detectTargetListSaveAffirmativeIntent([
      { role: "assistant", content: "Want me to save this to Hunter's target list under Blenders Eyewear?" },
      { role: "user", content: "go ahead" },
    ]),
    true
  );
  assert.equal(
    detectTargetListSaveAffirmativeIntent([
      { role: "assistant", content: "Here is the draft email for Blenders." },
      { role: "user", content: "yes" },
    ]),
    false
  );
});

const targetListOpts = {
  targetListContext: true,
  athleteId: "athlete-uuid",
};

test("target list: draft outreach classifies as email not company_targets", () => {
  const messages = [{ role: "user", content: "Draft outreach for Blenders Eyewear" }];
  assert.equal(detectCompanyTargetsIntent(messages, targetListOpts), false);
  assert.equal(classifyFlowIntent(messages, targetListOpts), "email_single_athlete");
});

test("target list: another eyewear brand does not trigger company_targets", () => {
  const messages = [{ role: "user", content: "Move on to drafting for another eyewear brand" }];
  assert.equal(detectCompanyTargetsIntent(messages, targetListOpts), false);
  assert.notEqual(classifyFlowIntent(messages, targetListOpts), "company_targets");
});

test("target list: explicit find sponsors still classifies as company_targets", () => {
  const messages = [{ role: "user", content: "Find more eyewear sponsors for Hunter Lawrence" }];
  assert.equal(detectExplicitProspectIntent(messages), true);
  assert.equal(detectCompanyTargetsIntent(messages, targetListOpts), true);
  assert.equal(classifyFlowIntent(messages, targetListOpts), "company_targets");
});

test("target list: who should we pitch for still matches explicit prospect", () => {
  const messages = [{ role: "user", content: "Who should we pitch for Jordan?" }];
  assert.equal(detectExplicitProspectIntent(messages), true);
  assert.equal(detectCompanyTargetsIntent(messages, targetListOpts), true);
});
