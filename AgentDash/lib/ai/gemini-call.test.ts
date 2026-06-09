import test from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableGeminiStatus,
  isEmptyPartnershipResearch,
  PARTNERSHIP_RESEARCH_EMPTY_SENTINEL,
} from "@/lib/ai/gemini-call";

test("isRetryableGeminiStatus treats overload as retryable", () => {
  assert.equal(isRetryableGeminiStatus(503, "UNAVAILABLE"), true);
  assert.equal(isRetryableGeminiStatus(undefined, "This model is currently experiencing high demand"), true);
  assert.equal(isRetryableGeminiStatus(429, "rate limit"), true);
  assert.equal(isRetryableGeminiStatus(400, "bad request"), false);
});

test("isEmptyPartnershipResearch matches sentinel", () => {
  assert.equal(isEmptyPartnershipResearch(PARTNERSHIP_RESEARCH_EMPTY_SENTINEL), true);
  assert.equal(isEmptyPartnershipResearch("**Action sports**\n- deal (https://x.com)"), false);
});
