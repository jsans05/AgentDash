import test from "node:test";
import assert from "node:assert/strict";
import {
  detectEmailEnrichmentIntent,
  detectEmailRevisionIntent,
} from "@/lib/ai/email-revision-intent";

const priorDraft = [
  {
    role: "assistant",
    content:
      "Subject: Jett x Boost\n\nHi,\n\nHope you are well.\n\nLooking forward to hearing from you,",
  },
];

test("detectEmailEnrichmentIntent matches demographic enrichment after draft", () => {
  const messages = [
    ...priorDraft,
    { role: "user", content: "Can you pull in demographic data and age selling points?" },
  ];
  assert.equal(detectEmailEnrichmentIntent(messages), true);
  assert.equal(detectEmailRevisionIntent(messages), true);
});

test("detectEmailEnrichmentIntent matches origin angle request", () => {
  const messages = [
    ...priorDraft,
    {
      role: "user",
      content:
        "They are Australians helping expand the brand in US motocross — bring that into the email",
    },
  ];
  assert.equal(detectEmailEnrichmentIntent(messages), true);
});

test("detectEmailEnrichmentIntent matches why important for brand", () => {
  const messages = [
    ...priorDraft,
    { role: "user", content: "Why are these things important for DJI?" },
  ];
  assert.equal(detectEmailEnrichmentIntent(messages), true);
});
