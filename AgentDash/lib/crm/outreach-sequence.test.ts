import assert from "node:assert/strict";
import test from "node:test";
import {
  cadenceFieldsFromSequence,
  cycleResponseStatus,
  cycleTouchStatus,
  findNextPendingStep,
  isStepBlocked,
  isStepDue,
  stepDueAt,
  type CardStepState,
  type SequenceStepDef,
} from "./outreach-sequence.js";

const STEPS: SequenceStepDef[] = [
  {
    id: "s1",
    sequence_id: "seq",
    step_order: 1,
    day_offset: 1,
    channel: "linkedin",
    action_label: "View",
    short_code: "LI1",
    phase: "warm_up",
    expects_response: false,
    is_optional: false,
    guidance: null,
  },
  {
    id: "s3",
    sequence_id: "seq",
    step_order: 3,
    day_offset: 4,
    channel: "linkedin",
    action_label: "Connect",
    short_code: "LI3",
    phase: "warm_up",
    expects_response: true,
    is_optional: false,
    guidance: null,
  },
  {
    id: "s8",
    sequence_id: "seq",
    step_order: 8,
    day_offset: 13,
    channel: "linkedin",
    action_label: "Message",
    short_code: "LI4",
    phase: "channel_switch",
    expects_response: true,
    is_optional: false,
    guidance: null,
  },
];

test("cycleTouchStatus pending → done → skipped → pending", () => {
  assert.equal(cycleTouchStatus("pending"), "done");
  assert.equal(cycleTouchStatus("done"), "skipped");
  assert.equal(cycleTouchStatus("skipped"), "pending");
});

test("cycleResponseStatus awaiting → responded → no_response → awaiting", () => {
  assert.equal(cycleResponseStatus("awaiting"), "responded");
  assert.equal(cycleResponseStatus("responded"), "no_response");
  assert.equal(cycleResponseStatus("no_response"), "awaiting");
});

test("stepDueAt adds day_offset from sequence start", () => {
  const due = stepDueAt("2026-07-01T15:00:00.000Z", 6);
  assert.equal(due.toISOString().slice(0, 10), "2026-07-07");
});

test("isStepDue is false when pending but before day offset", () => {
  assert.equal(
    isStepDue("2026-07-10T00:00:00.000Z", 6, "pending", new Date("2026-07-12T00:00:00.000Z")),
    false
  );
  assert.equal(
    isStepDue("2026-07-01T00:00:00.000Z", 6, "pending", new Date("2026-07-12T00:00:00.000Z")),
    true
  );
});

test("findNextPendingStep returns earliest pending; pauses when responded", () => {
  const states: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "s1",
      touch_status: "done",
      response_status: "awaiting",
      done_at: null,
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  const next = findNextPendingStep(
    STEPS,
    states,
    {
      sequence_id: "seq",
      sequence_started_at: "2026-07-01T00:00:00.000Z",
      responded_at: null,
    },
    new Date("2026-07-20T00:00:00.000Z")
  );
  assert.equal(next?.short_code, "LI3");

  const paused = findNextPendingStep(
    STEPS,
    states,
    {
      sequence_id: "seq",
      sequence_started_at: "2026-07-01T00:00:00.000Z",
      responded_at: "2026-07-05T00:00:00.000Z",
    },
    new Date("2026-07-20T00:00:00.000Z")
  );
  assert.equal(paused, null);
});

test("LI4 is blocked until LI3 connection accepted", () => {
  const li4 = STEPS.find((s) => s.short_code === "LI4")!;
  const states: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "s3",
      touch_status: "done",
      response_status: "no_response",
      done_at: null,
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  const blocked = isStepBlocked(li4, STEPS, states);
  assert.equal(blocked.blocked, true);

  const accepted: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "s3",
      touch_status: "done",
      response_status: "responded",
      done_at: null,
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  assert.equal(isStepBlocked(li4, STEPS, accepted).blocked, false);
});

test("cadenceFieldsFromSequence sets next_action from channel", () => {
  const fields = cadenceFieldsFromSequence(
    STEPS,
    [],
    {
      sequence_id: "seq",
      sequence_started_at: "2026-07-01T00:00:00.000Z",
      responded_at: null,
    },
    new Date("2026-07-20T00:00:00.000Z")
  );
  assert.equal(fields.next_action, "linkedin");
  assert.ok(fields.next_follow_up_at);
});
