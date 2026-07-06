import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_MODEL_IDS,
  parseChatModelTier,
  resolveChatModelId,
} from "@/lib/ai/chat-model";

test("parseChatModelTier accepts sonnet only", () => {
  assert.equal(parseChatModelTier("sonnet"), "sonnet");
  assert.equal(parseChatModelTier("SONNET"), "sonnet");
  assert.equal(parseChatModelTier("opus"), null);
  assert.equal(parseChatModelTier("invalid"), null);
});

test("resolveChatModelId maps tiers to Anthropic API IDs", () => {
  assert.equal(resolveChatModelId("sonnet"), CHAT_MODEL_IDS.sonnet);
  assert.equal(resolveChatModelId(null), CHAT_MODEL_IDS.sonnet);
});
