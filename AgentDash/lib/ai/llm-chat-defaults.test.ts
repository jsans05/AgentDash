import assert from "node:assert/strict";
import { test } from "node:test";
import { isAnthropicPromptCacheEnabled } from "@/lib/ai/llm-chat-defaults";

const originalCacheEnv = process.env.ANTHROPIC_PROMPT_CACHE_ENABLED;

function withPromptCacheEnv(value: string | undefined, fn: () => void) {
  if (value === undefined) {
    delete process.env.ANTHROPIC_PROMPT_CACHE_ENABLED;
  } else {
    process.env.ANTHROPIC_PROMPT_CACHE_ENABLED = value;
  }
  try {
    fn();
  } finally {
    if (originalCacheEnv === undefined) {
      delete process.env.ANTHROPIC_PROMPT_CACHE_ENABLED;
    } else {
      process.env.ANTHROPIC_PROMPT_CACHE_ENABLED = originalCacheEnv;
    }
  }
}

test("isAnthropicPromptCacheEnabled defaults to true", () => {
  withPromptCacheEnv(undefined, () => {
    assert.equal(isAnthropicPromptCacheEnabled(), true);
  });
});

test("isAnthropicPromptCacheEnabled respects false and off", () => {
  withPromptCacheEnv("false", () => {
    assert.equal(isAnthropicPromptCacheEnabled(), false);
  });
  withPromptCacheEnv("off", () => {
    assert.equal(isAnthropicPromptCacheEnabled(), false);
  });
});
