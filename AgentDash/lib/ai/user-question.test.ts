import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAskUserQuestionToolResult,
  formatInteractionUserSummary,
  parseAskUserQuestionToolArgs,
  USER_QUESTION_OTHER_ID,
} from "@/lib/ai/user-question";

test("parseAskUserQuestionToolArgs appends other option", () => {
  const prompt = parseAskUserQuestionToolArgs({
    question: "Pick categories",
    options: [
      { id: "fitness", label: "Fitness" },
      { id: "auto", label: "Automotive" },
    ],
    allow_multiple: true,
    allow_other: true,
  });
  assert.equal(prompt.question, "Pick categories");
  assert.equal(prompt.options.length, 3);
  assert.equal(prompt.options[2]?.id, USER_QUESTION_OTHER_ID);
});

test("parseAskUserQuestionToolArgs rejects duplicate ids", () => {
  assert.throws(
    () =>
      parseAskUserQuestionToolArgs({
        question: "Q",
        options: [
          { id: "a", label: "A" },
          { id: "a", label: "B" },
        ],
      }),
    /Duplicate/
  );
});

test("buildAskUserQuestionToolResult returns selections", () => {
  const prompt = parseAskUserQuestionToolArgs({
    question: "Sports?",
    options: [
      { id: "surf", label: "Surf" },
      { id: "bmx", label: "BMX" },
    ],
    allow_multiple: true,
    allow_other: false,
  });
  const result = buildAskUserQuestionToolResult(prompt, {
    conversation_id: "c1",
    tool_call_id: "t1",
    selected_ids: ["surf"],
  });
  assert.deepEqual(result.selected, [{ id: "surf", label: "Surf" }]);
  assert.equal(result.skipped, false);
});

test("formatInteractionUserSummary for skip", () => {
  const prompt = parseAskUserQuestionToolArgs({
    question: "Sports?",
    options: [
      { id: "surf", label: "Surf" },
      { id: "bmx", label: "BMX" },
    ],
  });
  const summary = formatInteractionUserSummary(prompt, {
    conversation_id: "c1",
    tool_call_id: "t1",
    selected_ids: [],
    skipped: true,
  });
  assert.match(summary, /Skipped/);
});
