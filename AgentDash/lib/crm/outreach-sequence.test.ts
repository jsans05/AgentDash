import assert from "node:assert/strict";
import test from "node:test";
import {
  cadenceFieldsFromSequence,
  cycleResponseStatus,
  cycleTouchStatus,
  effectiveStepDueAt,
  findNextPendingStep,
  isSequenceExhausted,
  isStepBlocked,
  isStepDue,
  sortSequenceSteps,
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
    id: "s2",
    sequence_id: "seq",
    step_order: 2,
    day_offset: 2,
    channel: "linkedin",
    action_label: "Engage",
    short_code: "LI2",
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
    id: "e1",
    sequence_id: "seq",
    step_order: 4,
    day_offset: 6,
    channel: "cold_email",
    action_label: "Email 1",
    short_code: "E1",
    phase: "first_wave",
    expects_response: true,
    is_optional: false,
    guidance: null,
  },
  {
    id: "e2",
    sequence_id: "seq",
    step_order: 5,
    day_offset: 8,
    channel: "cold_email",
    action_label: "Email 2",
    short_code: "E2",
    phase: "first_wave",
    expects_response: true,
    is_optional: false,
    guidance: null,
  },
  {
    id: "c1",
    sequence_id: "seq",
    step_order: 6,
    day_offset: 10,
    channel: "cold_call",
    action_label: "Call 1",
    short_code: "C1",
    phase: "first_wave",
    expects_response: false,
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

test("sortSequenceSteps renders E1 before E2 before C1", () => {
  const shuffled = [...STEPS].sort((a, b) => b.step_order - a.step_order);
  const ordered = sortSequenceSteps(shuffled).map((s) => s.short_code);
  const e1 = ordered.indexOf("E1");
  const e2 = ordered.indexOf("E2");
  const c1 = ordered.indexOf("C1");
  assert.ok(e1 >= 0 && e2 >= 0 && c1 >= 0);
  assert.ok(e1 < e2 && e2 < c1);
});

test("stepDueAt adds day_offset from sequence start", () => {
  const due = stepDueAt("2026-07-01T15:00:00.000Z", 6);
  assert.equal(due.toISOString().slice(0, 10), "2026-07-07");
});

test("isStepDue respects predecessor completion for chained steps", () => {
  const li1 = STEPS.find((s) => s.short_code === "LI1")!;
  const e1 = STEPS.find((s) => s.short_code === "E1")!;
  const e2 = STEPS.find((s) => s.short_code === "E2")!;
  const now = new Date("2026-07-20T00:00:00.000Z");
  const start = "2026-07-01T00:00:00.000Z";

  assert.equal(isStepDue(li1, STEPS, [], start, "pending", now), true);
  assert.equal(isStepDue(e1, STEPS, [], start, "pending", now), true);
  assert.equal(isStepDue(e2, STEPS, [], start, "pending", now), false);

  const e1Done: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "e1",
      touch_status: "done",
      response_status: "awaiting",
      done_at: "2026-07-10T12:00:00.000Z",
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  assert.equal(isStepDue(e2, STEPS, e1Done, start, "pending", now), true);

  const c1 = STEPS.find((s) => s.short_code === "C1")!;
  assert.equal(isStepDue(c1, STEPS, e1Done, start, "pending", now), false);

  const e2Done: CardStepState[] = [
    ...e1Done,
    {
      card_id: "c1",
      step_id: "e2",
      touch_status: "done",
      response_status: "awaiting",
      done_at: "2026-07-12T12:00:00.000Z",
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  assert.equal(isStepDue(c1, STEPS, e2Done, start, "pending", now), true);
});

test("E1 is not blocked by LI1", () => {
  const e1 = STEPS.find((s) => s.short_code === "E1")!;
  assert.equal(isStepBlocked(e1, STEPS, []).blocked, false);
});

test("E2 is blocked until E1 is done", () => {
  const e2 = STEPS.find((s) => s.short_code === "E2")!;
  assert.equal(isStepBlocked(e2, STEPS, []).blocked, true);
  assert.match(isStepBlocked(e2, STEPS, []).reason ?? "", /E1/);
});

test("effectiveStepDueAt anchors calls to prior email done_at", () => {
  const c1 = STEPS.find((s) => s.short_code === "C1")!;
  const states: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "e2",
      touch_status: "done",
      response_status: "awaiting",
      done_at: "2026-07-12T12:00:00.000Z",
      variant_id: null,
      outcome: null,
      notes: null,
    },
  ];
  const due = effectiveStepDueAt(c1, STEPS, states, "2026-07-01T00:00:00.000Z");
  assert.equal(due?.toISOString().slice(0, 10), "2026-07-14");
});

test("findNextPendingStep returns earliest unblocked pending; pauses when responded", () => {
  const states: CardStepState[] = [
    {
      card_id: "c1",
      step_id: "s1",
      touch_status: "done",
      response_status: "awaiting",
      done_at: "2026-07-02T00:00:00.000Z",
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
  assert.equal(next?.short_code, "LI2");

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

test("cadenceFieldsFromSequence uses circle_back_at while sequence is paused", () => {
  const paused = cadenceFieldsFromSequence(
    STEPS,
    [],
    {
      sequence_id: "seq",
      sequence_started_at: "2026-07-01T00:00:00.000Z",
      responded_at: "2026-07-05T00:00:00.000Z",
      circle_back_at: "2026-10-20T10:00:00.000Z",
    },
    new Date("2026-07-20T00:00:00.000Z")
  );
  assert.equal(paused.next_action, "circle_back");
  assert.equal(paused.next_follow_up_at, "2026-10-20T10:00:00.000Z");
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

test("isSequenceExhausted requires all non-optional steps done or skipped", () => {
  const card = {
    sequence_id: "seq",
    sequence_started_at: "2026-07-01T00:00:00.000Z",
    responded_at: null,
  };
  assert.equal(isSequenceExhausted(STEPS, [], card), false);
  const doneAll = STEPS.map((s) => ({
    card_id: "c1",
    step_id: s.id,
    touch_status: "done" as const,
    response_status: "awaiting" as const,
    done_at: null,
    variant_id: null,
    outcome: null,
    notes: null,
  }));
  assert.equal(isSequenceExhausted(STEPS, doneAll, card), true);
  assert.equal(
    isSequenceExhausted(STEPS, doneAll, { ...card, responded_at: "2026-07-02T00:00:00.000Z" }),
    false
  );
});
