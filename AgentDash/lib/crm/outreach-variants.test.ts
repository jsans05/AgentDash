import assert from "node:assert/strict";
import test from "node:test";
import { pickRoundRobinVariant, type OutreachVariant } from "./outreach-variants.js";

function v(
  id: string,
  label: string,
  channel: OutreachVariant["channel"],
  opts?: Partial<OutreachVariant>
): OutreachVariant {
  return {
    id,
    created_by_user_id: "u1",
    variant_label: label,
    name: null,
    channel,
    sequence_step_id: null,
    subject: null,
    body: "hello",
    is_active: true,
    archived: false,
    ...opts,
  };
}

test("pickRoundRobinVariant picks fewest sends", () => {
  const variants = [v("a", "A", "cold_email"), v("b", "B", "cold_email"), v("c", "C", "cold_email")];
  const picked = pickRoundRobinVariant(variants, "cold_email", {
    sendCounts: { a: 5, b: 2, c: 3 },
  });
  assert.equal(picked?.id, "b");
});

test("pickRoundRobinVariant prefers step-pinned variants when present", () => {
  const variants = [
    v("a", "A", "cold_email"),
    v("b", "B", "cold_email", { sequence_step_id: "step-e1" }),
    v("c", "C", "cold_email", { sequence_step_id: "step-e1" }),
  ];
  const picked = pickRoundRobinVariant(variants, "cold_email", {
    sequenceStepId: "step-e1",
    sendCounts: { b: 1, c: 0 },
  });
  assert.equal(picked?.id, "c");
});

test("pickRoundRobinVariant ignores inactive and empty body", () => {
  const variants = [
    v("a", "A", "cold_email", { is_active: false }),
    v("b", "B", "cold_email", { body: "   " }),
    v("c", "C", "linkedin", { body: "hi" }),
  ];
  assert.equal(pickRoundRobinVariant(variants, "cold_email"), null);
  assert.equal(pickRoundRobinVariant(variants, "linkedin")?.id, "c");
});
