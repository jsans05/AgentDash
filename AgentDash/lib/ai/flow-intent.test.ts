import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFlowIntent,
  detectInboundCompanyAthleteMatchIntent,
  detectTargetListOutreachPushIntent,
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
