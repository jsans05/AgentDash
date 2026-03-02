import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { fetchCreatorIQSnapshotsWorkingEndpoints } from "@/lib/creatoriq";
import { NextResponse } from "next/server";

const STALE_DAYS = 30;

export async function POST(req: Request) {
  const profile = await requireProfile();
  const body = await req.json().catch(() => ({}));
  const athlete_id = body.athlete_id;
  const force = body.force === true;

  if (!athlete_id) {
    return NextResponse.json({ error: "athlete_id required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: athlete } = await supabase
    .from("athletes")
    .select("creatoriq_publisher_id")
    .eq("athlete_id", athlete_id)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  // Check access: agent can only refresh athletes they represent (athlete_agents)
  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athlete_id)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  if (!athlete.creatoriq_publisher_id) {
    return NextResponse.json({ error: "No CreatorIQ Creator ID set" }, { status: 400 });
  }

  // Unless forced, skip if last snapshot (accounts or audience) is within 30 days
  if (!force) {
    const { data: latest } = await supabase
      .from("creatoriq_snapshots")
      .select("fetched_at")
      .eq("athlete_id", athlete_id)
      .in("snapshot_type", ["accounts", "audience"])
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.fetched_at) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - STALE_DAYS);
      if (new Date(latest.fetched_at) >= cutoff) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "Last snapshot within 30 days",
        });
      }
    }
  }

  try {
    const { snapshots, errors } = await fetchCreatorIQSnapshotsWorkingEndpoints(
      athlete.creatoriq_publisher_id
    );
    const serviceSupabase = await createServiceRoleClient();

    for (const { type, data } of snapshots) {
      await serviceSupabase.from("creatoriq_snapshots").insert({
        athlete_id,
        snapshot_type: type,
        raw_json: data,
      });
    }

    return NextResponse.json({
      success: true,
      snapshots_created: snapshots.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to refresh CreatorIQ data";
    console.error("CIQ refresh error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
