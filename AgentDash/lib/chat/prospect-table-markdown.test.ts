import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isGroupedProspectingTableHeader,
  isTargetListCompactTableContext,
} from "@/lib/chat/prospect-table-markdown";

test("isGroupedProspectingTableHeader matches prospect list table", () => {
  assert.ok(
    isGroupedProspectingTableHeader([
      "Company",
      "Match Score",
      "Website",
      "Partnership Justification",
    ])
  );
});

test("isGroupedProspectingTableHeader rejects legacy tables", () => {
  assert.equal(
    isGroupedProspectingTableHeader(["Athlete", "Company Recommendation", "Industry", "Rationale"]),
    false
  );
});

test("isTargetListCompactTableContext is true for embedded target list UIs", () => {
  assert.equal(isTargetListCompactTableContext("target_list"), true);
  assert.equal(isTargetListCompactTableContext("consulting_target_list"), true);
  assert.equal(isTargetListCompactTableContext("master_target_list"), true);
  assert.equal(isTargetListCompactTableContext("global"), false);
  assert.equal(isTargetListCompactTableContext(undefined), false);
});
