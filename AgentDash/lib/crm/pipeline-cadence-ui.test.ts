import assert from "node:assert/strict";
import test from "node:test";
import {
  isActionableDue,
  listCoolingCards,
  listDueCards,
  type PipelineCadenceCard,
} from "./pipeline-cadence-ui.js";

const base: PipelineCadenceCard = {
  id: "1",
  company_name: "Test Co",
  pipeline_stage: "follow_up",
  outreach_at: "2026-06-01T00:00:00Z",
  responded_at: null,
  follow_up_step: 5,
  next_follow_up_at: "2020-01-01T00:00:00Z",
  next_action: "cool",
  follow_up_log: [],
};

test("listDueCards excludes cooling step 5", () => {
  const due = listDueCards([base]);
  assert.equal(due.length, 0);
});

test("listCoolingCards includes step 5 in follow_up", () => {
  const cooling = listCoolingCards([base]);
  assert.equal(cooling.length, 1);
});

test("isActionableDue includes call step 3", () => {
  assert.equal(
    isActionableDue({
      pipeline_stage: "follow_up",
      outreach_at: "2026-06-01T00:00:00Z",
      responded_at: null,
      follow_up_step: 3,
      last_touch_at: null,
      next_follow_up_at: "2099-01-01T00:00:00Z",
      next_action: "call",
      follow_up_log: [],
    }),
    true
  );
});

test("listDueCards includes FU1 when date passed", () => {
  const card: PipelineCadenceCard = {
    ...base,
    follow_up_step: 1,
    next_action: "email",
    next_follow_up_at: "2020-01-01T00:00:00Z",
  };
  const due = listDueCards([card]);
  assert.equal(due.length, 1);
});
