import test from "node:test";
import assert from "node:assert/strict";
import { isSponsorGapCopyLine, stripSponsorGapCopy } from "@/lib/ai/email-copy-guard";

test("isSponsorGapCopyLine detects roster partner gap sentence", () => {
  const line =
    "With no current fragrance or luxury goods partner on Jett's roster, this would be a clean opportunity for MADIER to build an authentic partnership in an open category.";
  assert.equal(isSponsorGapCopyLine(line), true);
});

test("isSponsorGapCopyLine detects presents a clear open category phrasing", () => {
  const line =
    "Hunter presents a clear open category for premium grooming and fragrance partnerships given his audience skew.";
  assert.equal(isSponsorGapCopyLine(line), true);
});

test("stripSponsorGapCopy removes gap lines but keeps audience bullets", () => {
  const body = [
    "Hi Team,",
    "",
    "32% interested in Luxury Goods",
    "With no current fragrance partner on Jett's roster, this would be a clean opportunity.",
    "",
    "Looking forward to hearing from you,",
  ].join("\n");
  const out = stripSponsorGapCopy(body);
  assert.ok(!out.includes("clean opportunity"));
  assert.ok(out.includes("Luxury Goods"));
  assert.ok(out.includes("Looking forward"));
});
