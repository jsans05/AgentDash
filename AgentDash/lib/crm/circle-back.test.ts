import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCircleBackCardUpdates,
  circleBackBadgeLabel,
  isCircleBackDue,
  resolveCircleBackAt,
} from "./circle-back.js";

test("resolveCircleBackAt defaults to two months and lands on a weekday morning", () => {
  const now = new Date("2026-08-18T15:00:00");
  const iso = resolveCircleBackAt({}, now);
  const due = new Date(iso);
  assert.ok(due.getTime() > now.getTime());
  const day = due.getDay();
  assert.ok(day >= 2 && day <= 4);
  assert.ok(due.getMonth() === 9 || due.getMonth() === 10);
});

test("resolveCircleBackAt accepts an explicit future date", () => {
  const now = new Date("2026-08-18T15:00:00Z");
  const iso = resolveCircleBackAt({ follow_up_at: "2026-11-01T10:00:00Z" }, now);
  assert.equal(iso, "2026-11-01T10:00:00.000Z");
});

test("resolveCircleBackAt rejects past dates", () => {
  const now = new Date("2026-08-18T15:00:00Z");
  assert.throws(() => resolveCircleBackAt({ follow_up_at: "2026-01-01T00:00:00Z" }, now));
});

test("isCircleBackDue and badge distinguish waiting vs due", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  assert.equal(isCircleBackDue("2026-10-18T10:00:00Z", now), false);
  assert.match(circleBackBadgeLabel("2026-10-18T10:00:00Z", now) ?? "", /^Circle back · \d+d$/);
  assert.equal(isCircleBackDue("2026-08-01T10:00:00Z", now), true);
  assert.equal(circleBackBadgeLabel("2026-08-01T10:00:00Z", now), "Circle back due");
});

test("buildCircleBackCardUpdates pauses sequence in follow_up", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  const patch = buildCircleBackCardUpdates({
    circleBackAt: "2026-10-20T10:00:00.000Z",
    note: "  budget reset  ",
    now,
  });
  assert.equal(patch.pipeline_stage, "follow_up");
  assert.equal(patch.next_action, "circle_back");
  assert.equal(patch.circle_back_at, "2026-10-20T10:00:00.000Z");
  assert.equal(patch.next_follow_up_at, "2026-10-20T10:00:00.000Z");
  assert.equal(patch.circle_back_note, "budget reset");
  assert.equal(patch.responded_at, now.toISOString());
});
