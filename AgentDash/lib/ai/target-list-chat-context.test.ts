import test from "node:test";
import assert from "node:assert/strict";
import { getAthleteTargetListSessionAddon } from "@/lib/ai/flow-guards";
import { getCachedSurfaceGuidesBlock } from "@/lib/ai/prompts/cached-surface-guides";

test("session addon contains dynamic athlete id only (static rules in cached guides)", () => {
  const athleteId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const addon = getAthleteTargetListSessionAddon(athleteId, "Jordan Smith");
  assert.ok(addon.includes(athleteId));
  assert.ok(addon.includes("Jordan Smith"));
  assert.ok(!addon.includes("updateTargetListOutreach"));
  const cached = getCachedSurfaceGuidesBlock();
  assert.ok(cached.includes("updateTargetListOutreach"));
  assert.ok(/ATHLETE TARGET LIST/i.test(cached));
});

test("session addon is empty without athlete id", () => {
  assert.equal(getAthleteTargetListSessionAddon(""), "");
});
