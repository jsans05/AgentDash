import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssignedAthletes,
  maxMatchScoreFromAthletes,
} from "@/lib/crm/master-target-list";
import {
  dedupeAgencyActivity,
  formatAgencyActivityExport,
  isEmptyAgencyActivity,
} from "@/lib/crm/company-agency-activity";

test("buildAssignedAthletes filters to roster and preserves scores", () => {
  const roster = new Set(["a1", "a2"]);
  const athletes = buildAssignedAthletes(
    [
      { athlete_id: "a1", name: "Jane Doe", match_score: 85 },
      { athlete_id: "a3", name: "Other Agent Athlete", match_score: 50 },
      { athlete_id: "a2", name: "John Smith", match_score: 72 },
    ],
    roster
  );
  assert.equal(athletes.length, 2);
  assert.equal(athletes[0]!.name, "Jane Doe");
  assert.equal(athletes[0]!.match_score, 85);
  assert.equal(athletes[1]!.name, "John Smith");
});

test("maxMatchScoreFromAthletes returns highest score", () => {
  assert.equal(
    maxMatchScoreFromAthletes([
      { athlete_id: "a1", name: "A", match_score: 40 },
      { athlete_id: "a2", name: "B", match_score: 91 },
    ]),
    91
  );
  assert.equal(maxMatchScoreFromAthletes([{ athlete_id: "a1", name: "A", match_score: null }]), null);
});

test("dedupeAgencyActivity merges duplicate agents", () => {
  const deduped = dedupeAgencyActivity({
    on_other_target_lists: [
      {
        agent_user_id: "u2",
        agent_name: "Smith",
        pipeline_stage: "target",
        athlete_names: ["Jane"],
      },
      {
        agent_user_id: "u2",
        agent_name: "Smith",
        pipeline_stage: null,
        athlete_names: ["John"],
      },
    ],
    contacted_by_others: [
      {
        agent_user_id: "u2",
        agent_name: "Smith",
        last_outreach_at: "2025-01-01T00:00:00Z",
        outreach_channel: "email",
      },
      {
        agent_user_id: "u2",
        agent_name: "Smith",
        last_outreach_at: "2025-03-01T00:00:00Z",
        outreach_channel: "call",
      },
    ],
  });
  assert.equal(deduped.on_other_target_lists.length, 1);
  assert.deepEqual(deduped.on_other_target_lists[0]!.athlete_names.sort(), ["Jane", "John"]);
  assert.equal(deduped.contacted_by_others.length, 1);
  assert.equal(deduped.contacted_by_others[0]!.last_outreach_at, "2025-03-01T00:00:00Z");
});

test("formatAgencyActivityExport summarizes activity", () => {
  const text = formatAgencyActivityExport({
    on_other_target_lists: [
      {
        agent_user_id: "u2",
        agent_name: "Smith",
        pipeline_stage: "target",
        athlete_names: ["Jane Doe"],
      },
    ],
    contacted_by_others: [
      {
        agent_user_id: "u3",
        agent_name: "Jones",
        last_outreach_at: "2025-03-12T10:00:00Z",
        outreach_channel: "email",
      },
    ],
  });
  assert.ok(text.includes("Target list: Smith"));
  assert.ok(text.includes("Outreach: Jones"));
});

test("isEmptyAgencyActivity detects empty activity", () => {
  assert.equal(isEmptyAgencyActivity(null), true);
  assert.equal(
    isEmptyAgencyActivity({ on_other_target_lists: [], contacted_by_others: [] }),
    true
  );
  assert.equal(
    isEmptyAgencyActivity({
      on_other_target_lists: [
        {
          agent_user_id: "u1",
          agent_name: "A",
          pipeline_stage: null,
          athlete_names: [],
        },
      ],
      contacted_by_others: [],
    }),
    false
  );
});
