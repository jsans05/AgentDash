import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLocalTimeSnapshot,
  guessTimezoneFromWebsite,
} from "./outreach-local-time.js";

test("computeLocalTimeSnapshot returns nulls without timezone", () => {
  const snap = computeLocalTimeSnapshot("2026-07-08T20:00:00.000Z", null);
  assert.equal(snap.recipient_timezone, null);
  assert.equal(snap.recipient_local_hour, null);
  assert.equal(snap.recipient_local_dow, null);
});

test("computeLocalTimeSnapshot computes LA local hour", () => {
  // 20:00 UTC = 13:00 PDT in July
  const snap = computeLocalTimeSnapshot("2026-07-08T20:00:00.000Z", "America/Los_Angeles");
  assert.equal(snap.recipient_timezone, "America/Los_Angeles");
  assert.equal(snap.recipient_local_hour, 13);
  assert.equal(snap.recipient_local_dow, 3); // Wednesday
});

test("computeLocalTimeSnapshot computes Sydney local hour", () => {
  // 20:00 UTC = 06:00 next day AEST in July
  const snap = computeLocalTimeSnapshot("2026-07-08T20:00:00.000Z", "Australia/Sydney");
  assert.equal(snap.recipient_local_hour, 6);
  assert.equal(snap.recipient_local_dow, 4); // Thursday
});

test("guessTimezoneFromWebsite uses TLD heuristics", () => {
  assert.equal(guessTimezoneFromWebsite("https://goldfieldandbanks.com.au"), "Australia/Sydney");
  assert.equal(guessTimezoneFromWebsite("brand.co.uk"), "Europe/London");
  assert.equal(guessTimezoneFromWebsite("https://example.com"), null);
});
