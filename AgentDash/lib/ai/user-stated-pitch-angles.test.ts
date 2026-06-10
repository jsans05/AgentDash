import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUserStatedPitchAngles,
  getUserStatedAnglesAddon,
} from "@/lib/ai/user-stated-pitch-angles";

test("extractUserStatedPitchAngles returns empty array when no themes are named", () => {
  const angles = extractUserStatedPitchAngles([
    { role: "user", content: "draft an email for Jane Doe to Nike" },
  ]);
  assert.deepEqual(angles, []);
});

test("extractUserStatedPitchAngles extracts one explicit canonical interest", () => {
  const angles = extractUserStatedPitchAngles([
    {
      role: "user",
      content: "draft an email and lead with Fitness & Yoga for this pitch",
    },
  ]);
  assert.equal(angles.length, 1);
  assert.deepEqual(angles[0], { kind: "interest", name: "Fitness & Yoga" });
});

test("extractUserStatedPitchAngles extracts mixed dimensions", () => {
  const angles = extractUserStatedPitchAngles([
    {
      role: "user",
      content:
        "draft an email for Jane to Nike, emphasize the female 25-34 audience in Australia",
    },
  ]);

  const kinds = new Set(angles.map((angle) => angle.kind));
  assert.ok(kinds.has("gender"));
  assert.ok(kinds.has("age"));
  assert.ok(kinds.has("country"));
  assert.ok(angles.some((angle) => angle.kind === "gender" && angle.value === "female"));
  assert.ok(angles.some((angle) => angle.kind === "age" && angle.cohort === "25-34"));
  assert.ok(angles.some((angle) => angle.kind === "country" && angle.name === "Australia"));
});

test("extractUserStatedPitchAngles extracts focus-on themes conservatively", () => {
  const angles = extractUserStatedPitchAngles([
    {
      role: "user",
      content: "draft an email for Jane to Nike, focus on sustainability and trail running",
    },
  ]);

  assert.equal(angles.length, 2);
  assert.deepEqual(
    angles.map((angle) => (angle.kind === "interest" ? angle.name : null)),
    ["sustainability", "trail running"]
  );
});

test("extractUserStatedPitchAngles ignores ambiguous prose", () => {
  const angles = extractUserStatedPitchAngles([
    { role: "user", content: "this brand is great for the partnership" },
  ]);
  assert.deepEqual(angles, []);
});

test("getUserStatedAnglesAddon instructs composePitchEmail.pitch_angles", () => {
  const addon = getUserStatedAnglesAddon([{ kind: "interest", name: "Sports" }]);
  assert.match(addon, /composePitchEmail\.pitch_angles/);
  assert.match(addon, /ask_user_question/);
});
