import test from "node:test";
import assert from "node:assert/strict";
import { resolveEmailRoutingContext } from "@/lib/ai/email-routing-context";

test("combine after drafts resolves flow 6 without clarify", () => {
  const messages = [
    { role: "user", content: "Pitch Jett Lawrence and Hunter Lawrence to Boost Mobile" },
    {
      role: "assistant",
      content:
        "Subject: Jett Lawrence x Boost Mobile\n\nHi [Recipient Name],\n\nLooking forward to hearing from you,\n\n## Hunter Lawrence → Boost Mobile\n\nSubject: Hunter x Boost\n\nLooking forward to hearing from you,",
    },
    { role: "user", content: "Can you combine these into one email?" },
  ];
  const ctx = resolveEmailRoutingContext({ messages });
  assert.equal(ctx.should_clarify, false);
  assert.equal(ctx.flow, 6);
  assert.equal(ctx.company_name, "Boost Mobile");
  assert.ok(ctx.athlete_names.length >= 1);
  assert.equal(ctx.is_revision, true);
});
