import test from "node:test";
import assert from "node:assert/strict";
import {
  isEmailDraftContent,
  parseEmailDraftContent,
  rebuildEmailDraftContent,
} from "@/lib/chat/email-draft";

const SAMPLE_BODY = [
  "Hi Red Bull,",
  "",
  "Hope you are well.",
  "",
  "Looking forward to hearing from you,",
].join("\n");

test("parseEmailDraftContent extracts subject and body", () => {
  const text = `Subject: Bryce x Red Bull\n\n${SAMPLE_BODY}`;
  const parsed = parseEmailDraftContent(text);
  assert.ok(parsed);
  assert.equal(parsed!.subject, "Bryce x Red Bull");
  assert.equal(parsed!.body, SAMPLE_BODY);
  assert.equal(parsed!.preamble, "");
});

test("parseEmailDraftContent keeps preamble before Subject", () => {
  const text = `Here is a draft for you.\n\nSubject: Quick favor?\n\n${SAMPLE_BODY}`;
  const parsed = parseEmailDraftContent(text);
  assert.ok(parsed);
  assert.equal(parsed!.preamble, "Here is a draft for you.");
});

test("parseEmailDraftContent handles bold Subject markdown", () => {
  const text = `**Subject:** Partnership idea\n\n${SAMPLE_BODY}`;
  const parsed = parseEmailDraftContent(text);
  assert.ok(parsed);
  assert.equal(parsed!.subject, "Partnership idea");
});

test("parseEmailDraftContent rejects content without closing", () => {
  const text = "Subject: Hi\n\nNo closing here.";
  assert.equal(parseEmailDraftContent(text), null);
  assert.equal(isEmailDraftContent(text), false);
});

test("rebuildEmailDraftContent round-trips preamble and draft", () => {
  const parsed = {
    preamble: "One intro line.",
    subject: "Test subject",
    body: SAMPLE_BODY,
    postamble: "",
  };
  const rebuilt = rebuildEmailDraftContent(parsed);
  const again = parseEmailDraftContent(rebuilt);
  assert.ok(again);
  assert.equal(again!.preamble, parsed.preamble);
  assert.equal(again!.subject, parsed.subject);
  assert.equal(again!.body, parsed.body);
});
