import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetListSessionContext } from "@/lib/crm/target-list-session-context";
import {
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";

test("buildTargetListSessionContext includes athlete, filter, and selection", () => {
  const ctx = buildTargetListSessionContext({
    athleteId: "ath-1",
    athleteName: "Jordan Smith",
    activeCategoryFilter: "Fragrance",
    rows: [
      {
        pipeline_id: "pipe-1",
        company_id: "co-1",
        company_name: "Chanel",
        category: "Fragrance",
        match_score: 90,
        contacts: [{ contact_id: "c1", first_name: "Jane", last_name: "Doe" }],
      },
    ],
    selectedCompanyIds: new Set(["co-1"]),
    focusedRow: {
      pipelineId: "pipe-1",
      companyId: "co-1",
      companyName: "Chanel",
      category: "Fragrance",
      contactId: "c1",
      contactName: "Jane Doe",
      rowIndex: 0,
      contactIndex: 0,
    },
  });

  assert.ok(ctx.includes("ath-1"));
  assert.ok(ctx.includes("Jordan Smith"));
  assert.ok(ctx.includes("Fragrance"));
  assert.ok(ctx.includes("pipeline_id=pipe-1"));
  assert.ok(ctx.includes("contact_id=c1"));
  assert.ok(ctx.includes("Selected companies (1)"));
});

test("buildTargetListSessionContext formats uncategorized filter", () => {
  const ctx = buildTargetListSessionContext({
    athleteId: "ath-1",
    activeCategoryFilter: TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
    rows: [
      {
        pipeline_id: "p1",
        company_id: "c1",
        company_name: "Acme",
        category: null,
        match_score: null,
        contacts: [],
      },
    ],
    selectedCompanyIds: new Set(),
    focusedRow: null,
  });
  assert.ok(ctx.includes("Uncategorized"));
});

test("buildTargetListSessionContext all filter", () => {
  const ctx = buildTargetListSessionContext({
    athleteId: "ath-1",
    activeCategoryFilter: TARGET_LIST_CATEGORY_FILTER_ALL,
    rows: [],
    selectedCompanyIds: new Set(),
    focusedRow: null,
  });
  assert.ok(ctx.includes("All categories"));
});
