import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { APPROVED_INTEREST_CATEGORIES } from "@/lib/ai/interest-taxonomy";
import { encodePitchAngleId } from "@/lib/ai/pitch-angle-id";
import type { PitchAngle } from "@/lib/ai/pitch-angle-bullets";
import type { SuggestedPitchAngle } from "@/lib/ai/pitch-angle-curation";
import type { UserQuestionOption } from "@/lib/ai/user-question";
import type { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export const PITCH_ANGLE_PICKER_CATEGORIES = {
  interests: "Interests",
  age: "Age",
  gender: "Gender",
  country: "Country",
  brandAffinity: "Brand affinity",
} as const;

const AGE_COHORTS = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;

const GENDER_OPTIONS: Array<{ value: PitchAngle & { kind: "gender" }; label: string }> = [
  { value: { kind: "gender", value: "female" }, label: "Female" },
  { value: { kind: "gender", value: "male" }, label: "Male" },
  { value: { kind: "gender", value: "non_binary" }, label: "Non-binary" },
];

function isSuggestedPitchAngle(angle: SuggestedPitchAngle | PitchAngle): angle is SuggestedPitchAngle {
  return "strength" in angle;
}

function suggestedAngleToPitchAngle(angle: SuggestedPitchAngle | PitchAngle): PitchAngle | null {
  if (!isSuggestedPitchAngle(angle)) return angle;
  const value = String(angle.value ?? "").trim();
  if (!value) return null;
  switch (angle.kind) {
    case "interest":
      return { kind: "interest", name: value };
    case "age":
      return { kind: "age", cohort: value };
    case "gender":
      return { kind: "gender", value: value as "female" | "male" | "non_binary" };
    case "country":
      return { kind: "country", name: value };
    case "brand_affinity":
      return { kind: "brand_affinity", brand: value };
    default:
      return null;
  }
}

function pushOption(
  options: UserQuestionOption[],
  seen: Set<string>,
  angle: PitchAngle,
  category: string,
  label?: string
): void {
  const id = encodePitchAngleId(angle);
  if (!id || seen.has(id)) return;
  seen.add(id);
  options.push({
    id,
    label: label ?? (angle.kind === "interest" ? angle.name : id.split(":").slice(1).join(":")),
    category,
  });
}

export async function buildPitchAnglePickerOptions(input: {
  supabase: SupabaseClient;
  profile: Profile;
  suggested_angles?: Array<SuggestedPitchAngle | PitchAngle>;
  interest_names?: string[];
  athlete_id?: string | null;
  top_country_count?: number;
  top_brand_count?: number;
}): Promise<{ options: UserQuestionOption[] }> {
  const options: UserQuestionOption[] = [];
  const seen = new Set<string>();

  const suggestedPitchAngles = (input.suggested_angles ?? [])
    .map((angle) => suggestedAngleToPitchAngle(angle))
    .filter((angle): angle is PitchAngle => angle != null);

  const suggestedInterests = new Set<string>();
  for (const angle of suggestedPitchAngles) {
    if (angle.kind === "interest") suggestedInterests.add(angle.name);
  }
  for (const name of input.interest_names ?? []) {
    const trimmed = String(name ?? "").trim();
    if (trimmed) suggestedInterests.add(trimmed);
  }

  const interestOrder: string[] = [];
  for (const angle of suggestedPitchAngles) {
    if (angle.kind === "interest" && !interestOrder.includes(angle.name)) {
      interestOrder.push(angle.name);
    }
  }
  for (const name of suggestedInterests) {
    if (!interestOrder.includes(name)) interestOrder.push(name);
  }
  for (const label of APPROVED_INTEREST_CATEGORIES) {
    if (!interestOrder.includes(label)) interestOrder.push(label);
  }

  for (const name of interestOrder) {
    pushOption(options, seen, { kind: "interest", name }, PITCH_ANGLE_PICKER_CATEGORIES.interests);
  }

  const suggestedAges = new Set(
    suggestedPitchAngles.filter((angle) => angle.kind === "age").map((angle) => angle.cohort)
  );
  const ageOrder = [
    ...AGE_COHORTS.filter((cohort) => suggestedAges.has(cohort)),
    ...AGE_COHORTS.filter((cohort) => !suggestedAges.has(cohort)),
  ];
  for (const cohort of ageOrder) {
    pushOption(options, seen, { kind: "age", cohort }, PITCH_ANGLE_PICKER_CATEGORIES.age, cohort);
  }

  const suggestedGenders = new Set(
    suggestedPitchAngles.filter((angle) => angle.kind === "gender").map((angle) => angle.value)
  );
  const genderOrder = [
    ...GENDER_OPTIONS.filter((row) => suggestedGenders.has(row.value.value)),
    ...GENDER_OPTIONS.filter((row) => !suggestedGenders.has(row.value.value)),
  ];
  for (const row of genderOrder) {
    pushOption(options, seen, row.value, PITCH_ANGLE_PICKER_CATEGORIES.gender, row.label);
  }

  const athleteId = String(input.athlete_id ?? "").trim();
  if (athleteId) {
    const audience = await getAthleteAudienceProfile(input.supabase, athleteId);
    const topCountryCount = Math.max(1, Math.min(input.top_country_count ?? 8, 15));
    const topBrandCount = Math.max(1, Math.min(input.top_brand_count ?? 8, 15));

    const suggestedCountries = new Set(
      suggestedPitchAngles.filter((angle) => angle.kind === "country").map((angle) => angle.name)
    );
    const countryRows = [...(audience.countries ?? [])].sort(
      (a, b) => audiencePercentPoints(b.ig_audience_percent) - audiencePercentPoints(a.ig_audience_percent)
    );
    const countryNames: string[] = [];
    for (const row of countryRows) {
      const name = String(row.audience_name ?? "").trim();
      if (!name || countryNames.includes(name)) continue;
      countryNames.push(name);
      if (countryNames.length >= topCountryCount) break;
    }
    for (const name of suggestedCountries) {
      if (!countryNames.includes(name)) countryNames.unshift(name);
    }
    for (const name of countryNames) {
      const pct = countryRows.find((row) => row.audience_name === name);
      const label = pct
        ? `${name} (${audiencePercentPoints(pct.ig_audience_percent).toFixed(1)}%)`
        : name;
      pushOption(options, seen, { kind: "country", name }, PITCH_ANGLE_PICKER_CATEGORIES.country, label);
    }

    const suggestedBrands = new Set(
      suggestedPitchAngles.filter((angle) => angle.kind === "brand_affinity").map((angle) => angle.brand)
    );
    const brandRows = [...(audience.brands ?? [])].sort(
      (a, b) => audiencePercentPoints(b.ig_audience_percent) - audiencePercentPoints(a.ig_audience_percent)
    );
    const brandNames: string[] = [];
    for (const row of brandRows) {
      const name = String(row.audience_name ?? "").trim();
      if (!name || brandNames.includes(name)) continue;
      brandNames.push(name);
      if (brandNames.length >= topBrandCount) break;
    }
    for (const name of suggestedBrands) {
      if (!brandNames.includes(name)) brandNames.unshift(name);
    }
    for (const name of brandNames) {
      const pct = brandRows.find((row) => row.audience_name === name);
      const label = pct
        ? `${name} (${audiencePercentPoints(pct.ig_audience_percent).toFixed(1)}%)`
        : name;
      pushOption(
        options,
        seen,
        { kind: "brand_affinity", brand: name },
        PITCH_ANGLE_PICKER_CATEGORIES.brandAffinity,
        label
      );
    }
  }

  return { options };
}
