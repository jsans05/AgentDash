import { createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCreatorIQSnapshotsWorkingEndpoints } from "@/lib/creatoriq";
import { NextResponse } from "next/server";

const STALE_DAYS = 30;

/**
 * Monthly refresh endpoint (call via cron). Uses working endpoints only (accounts + audience).
 * Skips athletes whose latest accounts/audience snapshot is under 30 days old.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceRoleClient();
  const { data: allAthletes } = await supabase
    .from("athletes")
    .select("athlete_id, creatoriq_publisher_id")
    .not("creatoriq_publisher_id", "is", null);

  if (!allAthletes?.length) {
    return NextResponse.json({ message: "No athletes with CreatorIQ IDs" });
  }

  const { data: latestRows } = await supabase
    .from("creatoriq_snapshots")
    .select("athlete_id, fetched_at")
    .in("snapshot_type", ["accounts", "audience"]);

  const latestByAthlete = new Map<string, string>();
  for (const row of latestRows || []) {
    const existing = latestByAthlete.get(row.athlete_id);
    if (!existing || new Date(row.fetched_at) > new Date(existing)) {
      latestByAthlete.set(row.athlete_id, row.fetched_at);
    }
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  const toRefresh = allAthletes.filter((a) => {
    const last = latestByAthlete.get(a.athlete_id);
    return !last || new Date(last) < cutoff;
  });

  let refreshed = 0;
  const errors: string[] = [];

  for (const athlete of toRefresh) {
    try {
      const { snapshots, errors: fetchErrors } = await fetchCreatorIQSnapshotsWorkingEndpoints(
        athlete.creatoriq_publisher_id!
      );
      for (const { type, data } of snapshots) {
        await supabase.from("creatoriq_snapshots").insert({
          athlete_id: athlete.athlete_id,
          snapshot_type: type,
          raw_json: data,
        });
      }
      if (snapshots.length) refreshed++;
      if (fetchErrors.length) {
        errors.push(`${athlete.athlete_id}: ${fetchErrors.join("; ")}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${athlete.athlete_id}: ${msg}`);
    }
  }

  return NextResponse.json({
    refreshed,
    total_with_ciq: allAthletes.length,
    needed_refresh: toRefresh.length,
    errors: errors.length ? errors : undefined,
  });
}
