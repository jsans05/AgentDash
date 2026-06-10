import test from "node:test";
import assert from "node:assert/strict";
import {
  encodePitchAngleId,
  parsePitchAngleId,
  parsePitchAngleIds,
  pitchAnglesToInterestNames,
} from "@/lib/ai/pitch-angle-id";

test("parsePitchAngleId decodes categorized ids", () => {
  assert.deepEqual(parsePitchAngleId("interest:Fitness & Yoga"), {
    kind: "interest",
    name: "Fitness & Yoga",
  });
  assert.deepEqual(parsePitchAngleId("age:25-34"), { kind: "age", cohort: "25-34" });
  assert.deepEqual(parsePitchAngleId("gender:female"), { kind: "gender", value: "female" });
  assert.deepEqual(parsePitchAngleId("country:Australia"), { kind: "country", name: "Australia" });
  assert.deepEqual(parsePitchAngleId("brand_affinity:Nike"), {
    kind: "brand_affinity",
    brand: "Nike",
  });
});

test("parsePitchAngleId supports legacy flat interest ids", () => {
  assert.deepEqual(parsePitchAngleId("Sports"), { kind: "interest", name: "Sports" });
});

test("parsePitchAngleIds deduplicates mixed dimensions", () => {
  const angles = parsePitchAngleIds([
    "interest:Sports",
    "age:25-34",
    "country:Australia",
    "interest:Sports",
  ]);
  assert.equal(angles.length, 3);
});

test("encodePitchAngleId round-trips", () => {
  const angle = { kind: "interest" as const, name: "Fitness & Yoga" };
  assert.deepEqual(parsePitchAngleId(encodePitchAngleId(angle)), angle);
});

test("pitchAnglesToInterestNames returns canonical interests only", () => {
  const names = pitchAnglesToInterestNames([
    { kind: "interest", name: "Sports" },
    { kind: "interest", name: "sustainability" },
    { kind: "age", cohort: "25-34" },
  ]);
  assert.deepEqual(names, ["Sports"]);
});
