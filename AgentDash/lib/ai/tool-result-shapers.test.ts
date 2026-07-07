import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeToolResultForModel, stringifyToolResultForModel } from "@/lib/ai/tool-result-shapers";

test("shapeGenerateAthleteProspectList drops rows when markdown present", () => {
  const shaped = shapeToolResultForModel("generateAthleteProspectList", {
    ok: true,
    athlete: { athlete_id: "a1", name: "Test" },
    markdown: "| Company | Match Score |",
    rows: [{ company_name: "Acme", match_score: 90 }],
    blocked_companies: ["x", "y"],
  }) as { rows?: unknown; markdown?: string };
  assert.equal(shaped.markdown, "| Company | Match Score |");
  assert.equal("rows" in shaped, false);
});

test("shapeAthleteTargetList strips outreach bodies", () => {
  const shaped = shapeToolResultForModel("getAthleteTargetList", {
    ok: true,
    athlete: { athlete_id: "a1" },
    row_count: 1,
    rows: [
      {
        pipeline_id: "p1",
        company_name: "Acme",
        outreach_email: "Long email body...",
        outreach_email_subject: "Hi",
      },
    ],
  }) as { rows: Array<{ has_outreach_email?: boolean; outreach_email?: string }> };
  assert.equal(shaped.rows[0].has_outreach_email, true);
  assert.equal(shaped.rows[0].outreach_email, undefined);
});

test("stringifyToolResultForModel truncates oversized payloads", () => {
  const huge = stringifyToolResultForModel("getAthleteIntelligence", {
    athlete: { athlete_id: "a" },
    notes: ["x".repeat(30_000)],
  }, 1000);
  assert.ok(huge.includes("...(truncated)"));
});
