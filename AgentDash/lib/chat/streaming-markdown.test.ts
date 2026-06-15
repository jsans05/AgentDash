import assert from "node:assert/strict";
import test from "node:test";
import { repairStreamingMarkdown } from "./streaming-markdown";

test("repairStreamingMarkdown closes unclosed bold", () => {
  assert.equal(repairStreamingMarkdown("**Currently Covered"), "**Currently Covered**");
});

test("repairStreamingMarkdown leaves complete bold unchanged", () => {
  assert.equal(repairStreamingMarkdown("**done**"), "**done**");
});

test("repairStreamingMarkdown closes unclosed fenced code block", () => {
  assert.equal(repairStreamingMarkdown("```js\nconst x = 1"), "```js\nconst x = 1\n```");
});

test("repairStreamingMarkdown closes unclosed inline code", () => {
  assert.equal(repairStreamingMarkdown("Use `npm install"), "Use `npm install`");
});
