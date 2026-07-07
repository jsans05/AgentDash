import test from "node:test";
import assert from "node:assert/strict";
import { shouldAttemptMemoryLearning } from "@/lib/ai/memory-learning";

test("shouldAttemptMemoryLearning on revision corrections", () => {
  assert.equal(
    shouldAttemptMemoryLearning({
      messages: [{ role: "user", content: "make it shorter" }],
      correctionInjections: [],
      emailRevisionMode: true,
    }),
    true
  );
});

test("shouldAttemptMemoryLearning on user correction phrasing", () => {
  assert.equal(
    shouldAttemptMemoryLearning({
      messages: [{ role: "user", content: "No, use a warmer tone instead" }],
      correctionInjections: [],
      emailRevisionMode: false,
    }),
    true
  );
});

test("shouldAttemptMemoryLearning skips neutral messages", () => {
  assert.equal(
    shouldAttemptMemoryLearning({
      messages: [{ role: "user", content: "find sponsors for Griffin" }],
      correctionInjections: [],
      emailRevisionMode: false,
    }),
    false
  );
});
