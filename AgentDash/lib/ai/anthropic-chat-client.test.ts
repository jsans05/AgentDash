import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRequestParams,
  toAnthropicMessages,
  toAnthropicTools,
} from "@/lib/ai/anthropic-chat-client";

const originalCacheEnv = process.env.ANTHROPIC_PROMPT_CACHE_ENABLED;

function withPromptCacheEnabled(enabled: boolean, fn: () => void) {
  if (enabled) {
    delete process.env.ANTHROPIC_PROMPT_CACHE_ENABLED;
  } else {
    process.env.ANTHROPIC_PROMPT_CACHE_ENABLED = "false";
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

test("toAnthropicMessages joins system messages when caching is off", () => {
  withPromptCacheEnabled(false, () => {
    const { system } = toAnthropicMessages(
      [
        { role: "system", content: "Block A" },
        { role: "system", content: "Block B" },
        { role: "user", content: "Hello" },
      ],
      false
    );
    assert.equal(system, "Block A\n\nBlock B");
  });
});

test("toAnthropicMessages emits TextBlockParam array with cache_control", () => {
  withPromptCacheEnabled(true, () => {
    const { system } = toAnthropicMessages(
      [
        {
          role: "system",
          content: "Cached base",
          cache_control: { type: "ephemeral" },
        },
        { role: "system", content: "Dynamic context" },
        { role: "user", content: "Hello" },
      ],
      true
    );
    assert.ok(Array.isArray(system));
    assert.equal(system?.length, 2);
    assert.equal((system as Array<{ text: string; cache_control?: { type: string } }>)[0].text, "Cached base");
    assert.deepEqual(
      (system as Array<{ cache_control?: { type: string } }>)[0].cache_control,
      { type: "ephemeral" }
    );
    assert.equal((system as Array<{ text: string }>)[1].text, "Dynamic context");
    assert.equal((system as Array<{ cache_control?: unknown }>)[1].cache_control, undefined);
  });
});

test("toAnthropicTools marks only the last tool when cache_tools is true", () => {
  const tools = toAnthropicTools(
    [
      {
        type: "function",
        function: { name: "toolA", description: "A" },
      },
      {
        type: "function",
        function: { name: "toolB", description: "B" },
      },
    ],
    true
  );
  assert.ok(tools);
  assert.equal(tools![0].cache_control, undefined);
  assert.deepEqual(tools![1].cache_control, { type: "ephemeral" });
});

test("toAnthropicMessages appends user turn when conversation ends with assistant", () => {
  withPromptCacheEnabled(false, () => {
    const { messages } = toAnthropicMessages(
      [
        { role: "user", content: "Draft email" },
        { role: "assistant", content: "Here is a draft..." },
        { role: "system", content: "Required: call updateTargetListOutreach" },
      ],
      false
    );
    assert.equal(messages[messages.length - 1]?.role, "user");
    assert.match(String(messages[messages.length - 1]?.content ?? ""), /Continue with the required next step/);
  });
});

test("buildRequestParams uses plain system string when caching disabled", () => {
  withPromptCacheEnabled(false, () => {
    const params = buildRequestParams({
      messages: [
        {
          role: "system",
          content: "Static",
          cache_control: { type: "ephemeral" },
        },
        { role: "user", content: "Hi" },
      ],
    });
    assert.equal(typeof params.system, "string");
    assert.equal(params.system, "Static");
    assert.equal(params.tools, undefined);
  });
});

test("buildRequestParams uses structured system and cache_tools when enabled", () => {
  withPromptCacheEnabled(true, () => {
    const params = buildRequestParams({
      messages: [
        {
          role: "system",
          content: "Cached",
          cache_control: { type: "ephemeral" },
        },
        { role: "user", content: "Hi" },
      ],
      cache_tools: true,
      tools: [
        {
          type: "function",
          function: { name: "alpha", description: "first" },
        },
        {
          type: "function",
          function: { name: "beta", description: "last" },
        },
      ],
    });
    assert.ok(Array.isArray(params.system));
    assert.ok(params.tools?.length === 2);
    assert.equal(params.tools?.[0].cache_control, undefined);
    assert.deepEqual(params.tools?.[1].cache_control, { type: "ephemeral" });
  });
});
