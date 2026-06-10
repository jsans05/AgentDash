import test from "node:test";
import assert from "node:assert/strict";
import { buildPitchAnglePickerOptions, PITCH_ANGLE_PICKER_CATEGORIES } from "@/lib/ai/pitch-angle-picker";

test("buildPitchAnglePickerOptions returns categorized interest and demographic sections", async () => {
  const { options } = await buildPitchAnglePickerOptions({
    supabase: {} as any,
    profile: { user_id: "u1", role: "admin" } as any,
    suggested_angles: [
      { kind: "interest", value: "Fitness & Yoga", strength: "strong" },
      { kind: "age", value: "25-34", strength: "medium" },
    ],
    interest_names: ["Sports"],
  });

  const categories = new Set(options.map((option) => option.category));
  assert.ok(categories.has(PITCH_ANGLE_PICKER_CATEGORIES.interests));
  assert.ok(categories.has(PITCH_ANGLE_PICKER_CATEGORIES.age));
  assert.ok(categories.has(PITCH_ANGLE_PICKER_CATEGORIES.gender));
  assert.ok(options.some((option) => option.id === "interest:Fitness & Yoga"));
  assert.ok(options.every((option) => option.category));
});

test("buildPitchAnglePickerOptions omits country and brand without athlete_id", async () => {
  const { options } = await buildPitchAnglePickerOptions({
    supabase: {} as any,
    profile: { user_id: "u1", role: "admin" } as any,
    suggested_angles: [],
  });

  const categories = new Set(options.map((option) => option.category));
  assert.equal(categories.has(PITCH_ANGLE_PICKER_CATEGORIES.country), false);
  assert.equal(categories.has(PITCH_ANGLE_PICKER_CATEGORIES.brandAffinity), false);
});
