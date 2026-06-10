import assert from "node:assert/strict";
import test from "node:test";
import { createStreamTokenBatcher } from "./stream-token-batcher";

test("createStreamTokenBatcher coalesces tokens and marks first chunk", async () => {
  const updates: { text: string; isFirst: boolean }[] = [];
  const batcher = createStreamTokenBatcher({
    onUpdate: (text, isFirst) => updates.push({ text, isFirst }),
  });

  batcher.onToken("hel");
  batcher.onToken("lo");
  batcher.flush();

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { text: "hello", isFirst: true });

  batcher.onToken("!");
  batcher.flush();

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1], { text: "!", isFirst: false });
  batcher.dispose();
});
