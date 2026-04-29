import { createServerClient } from "@/lib/supabase/server";

export type AthleteMatchResult = {
  athlete_id: string | null;
  reason: string | null;
};

function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

export async function findAthleteByTalentOrName(
  talentId: string | null | undefined,
  rawName: string | null | undefined
): Promise<AthleteMatchResult> {
  const supabase = await createServerClient();
  const name = normalizeName(rawName);

  // Name-only matching (Talent ID / external IDs are intentionally ignored).
  if (!name) {
    return { athlete_id: null, reason: "Missing Name" };
  }

  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");

  if (!first || !last) {
    return { athlete_id: null, reason: `Name "${name}" must include first and last.` };
  }

  const { data: byName, error: nameError } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name")
    .ilike("first_name", first)
    .ilike("last_name", last)
    .limit(3);

  if (nameError) {
    return { athlete_id: null, reason: `Lookup error for Name "${name}"` };
  }
  if (!byName || byName.length === 0) {
    return { athlete_id: null, reason: `No athlete found for "${name}".` };
  }
  if (byName.length > 1) {
    return {
      athlete_id: null,
      reason: `Name "${name}" is ambiguous (${byName.length} matches); please disambiguate.`,
    };
  }

  return { athlete_id: byName[0]!.athlete_id, reason: null };
}

