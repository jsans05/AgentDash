import test from "node:test";
import assert from "node:assert/strict";
import { deriveRoutingFlowMode } from "@/components/chat/chat-routing";

test("deriveRoutingFlowMode maps embedded contexts", () => {
  assert.equal(deriveRoutingFlowMode("crm_pipeline"), "email");
  assert.equal(deriveRoutingFlowMode("target_list"), undefined);
});

test("deriveRoutingFlowMode uses URL flow mode only without embedded context", () => {
  assert.equal(deriveRoutingFlowMode(undefined, "inbound"), "inbound");
  assert.equal(deriveRoutingFlowMode("global", "outbound"), "outbound");
  assert.equal(deriveRoutingFlowMode(undefined, "auto"), undefined);
  assert.equal(deriveRoutingFlowMode(undefined), undefined);
});

test("deriveRoutingFlowMode prefers embedded context over URL param", () => {
  assert.equal(deriveRoutingFlowMode("crm_pipeline", "outbound"), "email");
  assert.equal(deriveRoutingFlowMode("target_list", "email"), undefined);
});
