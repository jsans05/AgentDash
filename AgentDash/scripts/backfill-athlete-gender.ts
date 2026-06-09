/**
 * One-time backfill: infer athlete gender and write to athletes.gender.
 * Run: npx tsx scripts/backfill-athlete-gender.ts
 */
import { createClient } from "@supabase/supabase-js";
import { inferAthleteGender, formatAthleteGender } from "../lib/athletes/gender";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: athletes, error } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, accolades, notes, gender")
    .order("last_name")
    .order("first_name");

  if (error) {
    console.error(error);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  const unknown: string[] = [];

  for (const athlete of athletes ?? []) {
    const inferred = inferAthleteGender(athlete);
    const name = [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim();

    if (athlete.gender === inferred) {
      skipped++;
      continue;
    }

    if (!inferred) {
      unknown.push(name || athlete.athlete_id);
    }

    const { error: updateError } = await supabase
      .from("athletes")
      .update({ gender: inferred })
      .eq("athlete_id", athlete.athlete_id);

    if (updateError) {
      console.error(`Failed ${name}:`, updateError.message);
      continue;
    }
    updated++;
    console.log(`${name}: ${formatAthleteGender(inferred) ?? "(null)"}`);
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
  if (unknown.length) {
    console.log(`\nCould not infer (${unknown.length}):`);
    unknown.forEach((n) => console.log(`  - ${n}`));
  }
}

main();
