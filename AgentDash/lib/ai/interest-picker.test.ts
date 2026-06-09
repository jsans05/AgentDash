import assert from "node:assert/strict";
import test from "node:test";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";
import {
  buildFullInterestPickerOptions,
  expandInterestPickerOptionsIfNeeded,
} from "@/lib/ai/interest-picker";
import { parseAskUserQuestionToolArgs } from "@/lib/ai/user-question";

test("buildFullInterestPickerOptions returns entire canonical taxonomy", () => {
  const opts = buildFullInterestPickerOptions();
  assert.equal(opts.length, APPROVED_INTEREST_CATEGORIES.length);
});

test("buildFullInterestPickerOptions puts preferred labels first", () => {
  const opts = buildFullInterestPickerOptions(["Sports", "Camera & Photography"]);
  assert.equal(opts[0]?.label, "Sports");
  assert.equal(opts[1]?.label, "Camera & Photography");
  assert.equal(opts.length, APPROVED_INTEREST_CATEGORIES.length);
});

test("expandInterestPickerOptionsIfNeeded fills partial canonical subset", () => {
  const partial = [
    { id: "Sports", label: "Sports" },
    { id: "Activewear", label: "Activewear" },
  ];
  const expanded = expandInterestPickerOptionsIfNeeded(
    "Which audience interest categories best fit this company?",
    partial
  );
  assert.equal(expanded.length, APPROVED_INTEREST_CATEGORIES.length);
  assert.equal(expanded[0]?.label, "Sports");
  assert.equal(expanded[1]?.label, "Activewear");
});

test("parseAskUserQuestionToolArgs expands partial interest picker to full catalog", () => {
  const prompt = parseAskUserQuestionToolArgs({
    question: "Which audience interest categories are most relevant?",
    options: [
      { id: "Sports", label: "Sports" },
      { id: "Activewear", label: "Activewear" },
    ],
    allow_multiple: true,
    allow_skip: true,
  });
  assert.equal(prompt.options.length, APPROVED_INTEREST_CATEGORIES.length);
  assert.equal(prompt.allow_skip, false);
});
