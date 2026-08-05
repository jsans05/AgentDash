import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNotBlockedCompanyName,
  BlockedCompanyNameError,
  isBlockedCompanyName,
} from "@/lib/import/blocked-company-names";

test("blocks Gorilla RX Wellness and normalized variants", () => {
  assert.equal(isBlockedCompanyName("Gorilla RX Wellness"), true);
  assert.equal(isBlockedCompanyName("gorilla rx wellness"), true);
  assert.equal(isBlockedCompanyName("  Gorilla-RX  Wellness  "), true);
  assert.equal(isBlockedCompanyName("Gorilla RX Wellness!"), true);
});

test("allows unrelated company names", () => {
  assert.equal(isBlockedCompanyName("Nike"), false);
  assert.equal(isBlockedCompanyName("Gorilla Glue"), false);
  assert.equal(isBlockedCompanyName(""), false);
  assert.equal(isBlockedCompanyName(null), false);
});

test("assertNotBlockedCompanyName throws BlockedCompanyNameError", () => {
  assert.throws(
    () => assertNotBlockedCompanyName("Gorilla RX Wellness"),
    (err: unknown) => err instanceof BlockedCompanyNameError
  );
  assert.doesNotThrow(() => assertNotBlockedCompanyName("Red Bull"));
});
