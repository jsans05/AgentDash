import test from "node:test";
import assert from "node:assert/strict";
import { getAthleteTargetListSessionAddon } from "@/lib/ai/flow-guards";

test("session addon contains athlete id and updateTargetListOutreach guidance", () => {
  const athleteId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const addon = getAthleteTargetListSessionAddon(athleteId, "Jordan Smith");
  assert.ok(addon.includes(athleteId));
  assert.ok(addon.includes("updateTargetListOutreach"));
  assert.ok(/FLOW 8D/i.test(addon));
  assert.ok(/must \*\*NOT\*\* use \*\*pushEmailToCrm\*\*/i.test(addon));
  assert.ok(addon.includes("Jordan Smith"));
});

test("session addon is empty without athlete id", () => {
  assert.equal(getAthleteTargetListSessionAddon(""), "");
});
