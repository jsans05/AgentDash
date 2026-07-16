import assert from "node:assert/strict";
import test from "node:test";
import { buildPipelineAnalytics, type PipelineAnalyticsRow } from "./pipeline-analytics.js";

function row(partial: Partial<PipelineAnalyticsRow> & { id: string }): PipelineAnalyticsRow {
  return {
    company_name: "Co",
    created_by_user_id: "u1",
    pipeline_stage: "target",
    outreach_at: null,
    responded_at: null,
    follow_up_step: 0,
    archived: false,
    ...partial,
  };
}

test("buildPipelineAnalytics counts stages and closed value", () => {
  const snap = buildPipelineAnalytics(
    [
      row({ id: "1", pipeline_stage: "closed", closed_value: 10000 }),
      row({ id: "2", pipeline_stage: "target" }),
      row({ id: "3", pipeline_stage: "follow_up", outreach_at: "2026-01-01T00:00:00Z", follow_up_step: 5, next_action: "cool", next_follow_up_at: "2020-01-01T00:00:00Z" }),
    ],
    "mine"
  );
  assert.equal(snap.kpis.totalActive, 3);
  assert.equal(snap.kpis.closedDeals, 1);
  assert.equal(snap.kpis.closedValue, 10000);
  assert.equal(snap.kpis.cooling, 1);
  assert.equal(snap.kpis.dueNow, 0);
});

test("buildPipelineAnalytics computes response rate", () => {
  const snap = buildPipelineAnalytics(
    [
      row({ id: "1", pipeline_stage: "in_progress", outreach_at: "2026-01-01T00:00:00Z", responded_at: "2026-01-05T00:00:00Z" }),
      row({ id: "2", pipeline_stage: "follow_up", outreach_at: "2026-01-01T00:00:00Z" }),
    ],
    "mine"
  );
  assert.equal(snap.kpis.responseRatePct, 50);
});
