import test from "node:test";
import assert from "node:assert/strict";
import { getFlowModeEnforcement } from "@/lib/ai/feature-flags";

const original = process.env.FLOW_MODE_ENFORCEMENT;

test.after(() => {
  if (original === undefined) delete process.env.FLOW_MODE_ENFORCEMENT;
  else process.env.FLOW_MODE_ENFORCEMENT = original;
});

test("getFlowModeEnforcement defaults to schema", () => {
  delete process.env.FLOW_MODE_ENFORCEMENT;
  assert.equal(getFlowModeEnforcement(), "schema");
});

test("getFlowModeEnforcement accepts advisory and off", () => {
  process.env.FLOW_MODE_ENFORCEMENT = "advisory";
  assert.equal(getFlowModeEnforcement(), "advisory");
  process.env.FLOW_MODE_ENFORCEMENT = "OFF";
  assert.equal(getFlowModeEnforcement(), "off");
});

test("getFlowModeEnforcement treats unknown values as schema", () => {
  process.env.FLOW_MODE_ENFORCEMENT = "banana";
  assert.equal(getFlowModeEnforcement(), "schema");
});
