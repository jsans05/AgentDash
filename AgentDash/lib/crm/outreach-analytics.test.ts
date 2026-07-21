import assert from "node:assert/strict";
import test from "node:test";
import { buildOutreachAnalytics, type OutreachEventRow } from "./outreach-analytics.js";

test("buildOutreachAnalytics computes channel reply rates and low-sample flags", () => {
  const events: OutreachEventRow[] = [
    {
      id: "1",
      pipeline_card_id: "c1",
      contact_id: null,
      user_id: "u1",
      event_type: "touch",
      channel: "cold_email",
      sequence_step_id: null,
      variant_id: "va",
      product_category: "Fragrance",
      occurred_at: "2026-07-01T12:00:00.000Z",
      outcome: "sent",
      recipient_timezone: "America/Los_Angeles",
      recipient_local_hour: 10,
      recipient_local_dow: 2,
      variant_label: "A",
    },
    {
      id: "2",
      pipeline_card_id: "c1",
      contact_id: null,
      user_id: "u1",
      event_type: "response",
      channel: "cold_email",
      sequence_step_id: null,
      variant_id: "va",
      product_category: "Fragrance",
      occurred_at: "2026-07-02T12:00:00.000Z",
      outcome: "positive",
      recipient_timezone: "America/Los_Angeles",
      recipient_local_hour: 11,
      recipient_local_dow: 3,
      variant_label: "A",
    },
    {
      id: "3",
      pipeline_card_id: "c2",
      contact_id: null,
      user_id: "u1",
      event_type: "touch",
      channel: "instagram_dm",
      sequence_step_id: null,
      variant_id: null,
      product_category: null,
      occurred_at: "2026-07-03T12:00:00.000Z",
      outcome: "sent",
      recipient_timezone: null,
      recipient_local_hour: null,
      recipient_local_dow: null,
    },
  ];

  const snap = buildOutreachAnalytics(events, { scope: "mine" });
  assert.equal(snap.kpis.totalTouches, 2);
  assert.equal(snap.kpis.totalReplies, 1);
  assert.equal(snap.kpis.timezoneMissing, 1);
  assert.equal(snap.channelPerformance.find((c) => c.channel === "cold_email")?.replies, 1);
  const variantA = snap.variantComparison.find((v) => v.variant_id === "va");
  assert.ok(variantA);
  assert.equal(variantA!.lowSample, true);
  assert.equal(variantA!.replyRatePct, 100);
});
