import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIgAudiencePercentToFraction,
  resolveAudiencePercentFraction,
} from "@/lib/athlete-data";

test("resolveAudiencePercentFraction uses count/following when available", () => {
  assert.ok(
    Math.abs(resolveAudiencePercentFraction(0.5928, 744, 125_424) - 744 / 125_424) < 1e-6
  );
  assert.ok(
    Math.abs(resolveAudiencePercentFraction(0.083848, 10_609, 126_531) - 10_609 / 126_531) < 1e-6
  );
});

test("resolveAudiencePercentFraction falls back when following is missing", () => {
  assert.ok(Math.abs(resolveAudiencePercentFraction(59.3, 100, null) - 0.593) < 1e-4);
  assert.ok(Math.abs(resolveAudiencePercentFraction(0.493, 100, null) - 0.493) < 1e-4);
});

test("normalizeIgAudiencePercentToFraction treats values above 1 as percent points", () => {
  assert.ok(Math.abs(normalizeIgAudiencePercentToFraction(59.3) - 0.593) < 1e-4);
});
