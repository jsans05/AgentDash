import test from "node:test";
import assert from "node:assert/strict";
import { getPlaybookForIntent } from "@/lib/ai/playbooks";

test("getPlaybookForIntent returns outbound for company_targets", () => {
  const pb = getPlaybookForIntent("company_targets", {
    senderDisplayName: "Test",
    sportsListNumbered: "1. Surfing",
  });
  assert.match(pb, /getSponsorshipTargets|prospect/i);
});

test("getPlaybookForIntent returns email for email_single_athlete", () => {
  const pb = getPlaybookForIntent("email_single_athlete", {
    senderDisplayName: "Test User",
    sportsListNumbered: "1. Surfing",
  });
  assert.match(pb, /composePitchEmail|OUTREACH EMAIL/i);
});

test("getPlaybookForIntent bulk import overrides intent", () => {
  const pb = getPlaybookForIntent("company_targets", {
    senderDisplayName: "Test",
    sportsListNumbered: "1. Surfing",
    includeBulkImport: true,
  });
  assert.match(pb, /bulkImportCompaniesToCrmForAthlete/i);
});
