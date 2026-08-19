import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysSnapped,
  applyCadenceTouch,
  cadenceBadgeLabel,
  initCadenceOnSend,
  processCadenceDue,
  snapToTueThuMorning,
} from "./pipeline-cadence.js";

test("snapToTueThuMorning moves Monday to Tuesday", () => {
  const mon = new Date("2026-07-06T15:00:00"); // Monday
  const snapped = snapToTueThuMorning(mon);
  assert.equal(snapped.getDay(), 2);
});

test("snapToTueThuMorning moves Friday to next Tuesday", () => {
  const fri = new Date("2026-07-10T15:00:00"); // Friday
  const snapped = snapToTueThuMorning(fri);
  assert.equal(snapped.getDay(), 2);
  assert.equal(snapped.getDate(), 14);
});

test("initCadenceOnSend sets step 0 and email next action", () => {
  const now = new Date("2026-07-08T12:00:00");
  const init = initCadenceOnSend(now);
  assert.equal(init.follow_up_step, 0);
  assert.equal(init.next_action, "email");
  assert.ok(init.next_follow_up_at);
});

test("applyCadenceTouch FU2 advances to call due", () => {
  const card = {
    pipeline_stage: "follow_up" as const,
    outreach_at: "2026-07-01T00:00:00Z",
    responded_at: null,
    follow_up_step: 2,
    last_touch_at: "2026-07-01T00:00:00Z",
    next_follow_up_at: "2026-07-08T00:00:00Z",
    next_action: "email" as const,
    follow_up_log: [],
  };
  const next = applyCadenceTouch(card, { channel: "email" }, new Date("2026-07-08T10:00:00"));
  assert.equal(next?.follow_up_step, 3);
  assert.equal(next?.next_action, "call");
});

test("processCadenceDue moves cooling to ghost", () => {
  const card = {
    pipeline_stage: "follow_up" as const,
    outreach_at: "2026-06-01T00:00:00Z",
    responded_at: null,
    follow_up_step: 5,
    last_touch_at: "2026-07-01T00:00:00Z",
    next_follow_up_at: "2026-07-01T00:00:00Z",
    next_action: "cool" as const,
    follow_up_log: [],
  };
  const next = processCadenceDue(card, new Date("2026-07-08T00:00:00Z"));
  assert.equal(next?.pipeline_stage, "ghost");
});

test("cadenceBadgeLabel shows circle back while waiting", () => {
  const waiting = cadenceBadgeLabel({
    pipeline_stage: "follow_up",
    outreach_at: "2026-07-01T00:00:00Z",
    responded_at: "2026-08-01T00:00:00Z",
    follow_up_step: 2,
    last_touch_at: null,
    next_follow_up_at: "2099-10-01T00:00:00Z",
    next_action: "circle_back",
    follow_up_log: [],
    circle_back_at: "2099-10-01T00:00:00Z",
  });
  assert.ok(waiting?.startsWith("Circle back"));
  assert.notEqual(waiting, "Circle back due");
});

test("cadenceBadgeLabel shows Call due at step 3", () => {
  const label = cadenceBadgeLabel({
    pipeline_stage: "follow_up",
    outreach_at: "2026-07-01T00:00:00Z",
    responded_at: null,
    follow_up_step: 3,
    last_touch_at: null,
    next_follow_up_at: null,
    next_action: "call",
    follow_up_log: [],
  });
  assert.equal(label, "Call due");
});

test("addDaysSnapped returns ISO string", () => {
  const iso = addDaysSnapped(new Date("2026-07-08T12:00:00"), 7);
  assert.ok(iso.includes("T"));
});
