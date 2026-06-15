import assert from "node:assert/strict";
import test from "node:test";
import { resolveSportToCanonical } from "@/lib/taxonomy-sport-resolve";

const cases: Array<{ roster: string; expected: string }> = [
  { roster: "Motorsports/Two Wheel - Road Race", expected: "Moto GP" },
  { roster: "Motorsports/Four Wheel - Off Road", expected: "Four Wheel Offroad" },
  { roster: "Motorsports/Four Wheel - Drag Racer", expected: "Drag" },
  { roster: "Motorsports/Four Wheel - Indy Car/F1", expected: "Indy / F1" },
  { roster: "Motorsports/Four Wheel Racing Academy/F1", expected: "Indy / F1" },
  { roster: "Racing Academy/F1", expected: "Indy / F1" },
  { roster: "Motorsports/Two Wheel - Supercross/Motocross", expected: "Supercross / Motocross (Moto)" },
  { roster: "Motorsports/Two Wheel - Freestyle Moto", expected: "Supercross / Motocross (Moto)" },
  { roster: "Motorsports/Two Wheel - Legends", expected: "Supercross / Motocross (Moto)" },
  { roster: "Lifestyle - Broadcast", expected: "Lifestyle" },
  { roster: "Lifestyle - Chef", expected: "Lifestyle" },
  { roster: "Lifestyle - Personality", expected: "Lifestyle" },
  { roster: "Lifestyle / Broadcast / Chef / Personality", expected: "Lifestyle" },
  { roster: "Cycling", expected: "Cycling" },
  { roster: "Diving", expected: "Diving" },
  { roster: "Kitesurfing", expected: "Kitesurfing" },
  { roster: "Softball", expected: "Softball" },
  { roster: "Lifestyle - Breakdancing", expected: "Lifestyle - Breakdancing" },
  { roster: "Marathon/Half Marathon", expected: "Marathon/Half Marathon" },
  { roster: "Snow - Ski", expected: "Ski" },
  { roster: "Snow - Snowboard", expected: "Snowboard" },
];

for (const { roster, expected } of cases) {
  test(`resolveSportToCanonical maps ${roster}`, () => {
    assert.equal(resolveSportToCanonical(roster), expected);
  });
}

test("resolveSportToCanonical does not map four-wheel roster values to Supercross / Motocross (Moto)", () => {
  assert.notEqual(
    resolveSportToCanonical("Motorsports/Four Wheel - Off Road"),
    "Supercross / Motocross (Moto)"
  );
});

test("resolveSportToCanonical returns null for unknown sports", () => {
  assert.equal(resolveSportToCanonical("Outdoor - Adventurer"), null);
});

test("resolveSportToCanonical defaults ambiguous motorsports to Four Wheel Offroad", () => {
  assert.equal(resolveSportToCanonical("Motorsports"), "Four Wheel Offroad");
});
