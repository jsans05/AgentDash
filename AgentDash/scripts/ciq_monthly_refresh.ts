/**
 * CreatorIQ monthly snapshot refresh (working endpoints only: accounts + audience).
 * Run with env loaded (e.g. Replit Secrets or .env.local).
 *
 * Usage: npx tsx scripts/ciq_monthly_refresh.ts
 * Or:    npm run ciq:refresh
 */

import { createClient } from "@supabase/supabase-js";
import { fetchCreatorIQSnapshotsWorkingEndpoints } from "../lib/creatoriq";

const RATE_LIMIT_MS_MIN = 300;
const RATE_LIMIT_MS_MAX = 600;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!process.env.CREATORIQ_API_KEY) {
    console.error("Missing CREATORIQ_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Get all athletes with creatoriq_publisher_id
  const { data: allWithCiq, error: e1 } = await supabase
    .from("athletes")
    .select("athlete_id, creatoriq_publisher_id")
    .not("creatoriq_publisher_id", "is", null);
  if (e1) {
    console.error("Failed to fetch athletes:", e1.message);
    process.exit(1);
  }
  if (!allWithCiq?.length) {
    console.log("No athletes with CreatorIQ IDs. Done.");
    return;
  }

  // 2) Get latest fetched_at per athlete for accounts/audience
  const { data: latestSnapshots } = await supabase
    .from("creatoriq_snapshots")
    .select("athlete_id, fetched_at")
    .in("snapshot_type", ["accounts", "audience"]);

  const latestByAthlete = new Map<string, string>();
  for (const row of latestSnapshots || []) {
    const existing = latestByAthlete.get(row.athlete_id);
    if (!existing || new Date(row.fetched_at) > new Date(existing)) {
      latestByAthlete.set(row.athlete_id, row.fetched_at);
    }
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const toRefresh = allWithCiq.filter((a) => {
    const last = latestByAthlete.get(a.athlete_id);
    return !last || new Date(last) < cutoff;
  });

  console.log(`Athletes with CIQ ID: ${allWithCiq.length}. Needing refresh: ${toRefresh.length}`);

  let refreshed = 0;
  const errors: { athlete_id: string; message: string }[] = [];

  for (let i = 0; i < toRefresh.length; i++) {
    const athlete = toRefresh[i];
    const publisherId = athlete.creatoriq_publisher_id!;
    try {
      const { snapshots, errors: fetchErrors } = await fetchCreatorIQSnapshotsWorkingEndpoints(
        publisherId
      );
      for (const { type, data } of snapshots) {
        const { error: insertErr } = await supabase.from("creatoriq_snapshots").insert({
          athlete_id: athlete.athlete_id,
          snapshot_type: type,
          raw_json: data,
        });
        if (insertErr) {
          errors.push({ athlete_id: athlete.athlete_id, message: `insert ${type}: ${insertErr.message}` });
        }
      }
      if (fetchErrors.length) {
        errors.push({
          athlete_id: athlete.athlete_id,
          message: fetchErrors.join("; "),
        });
      }
      if (snapshots.length > 0) refreshed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CIQ] ${athlete.athlete_id} (${publisherId}):`, message);
      errors.push({ athlete_id: athlete.athlete_id, message });
    }

    if (i < toRefresh.length - 1) {
      await delay(randomBetween(RATE_LIMIT_MS_MIN, RATE_LIMIT_MS_MAX));
    }
  }

  console.log("Summary: refreshed", refreshed, "athletes; errors:", errors.length);
  if (errors.length) {
    errors.forEach((e) => console.error(" ", e.athlete_id, e.message));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
