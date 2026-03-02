import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCiqEngagementRate } from "@/lib/creatoriq";

export async function POST(req: Request) {
  const profile = await requireProfile();
  const url = new URL(req.url);
  const searchAthleteId = url.searchParams.get("athleteId");
  const body = await req.json().catch(() => ({}));
  const athlete_id = body.athlete_id ?? searchAthleteId;

  if (!athlete_id) {
    return NextResponse.json({ error: "athlete_id required" }, { status: 400 });
  }

  const supabase = await createServerClient();

  // Load athlete + publisher id
  const { data: athlete } = await supabase
    .from("athletes")
    .select("athlete_id, creatoriq_publisher_id")
    .eq("athlete_id", athlete_id)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  // Access: agent can only refresh athletes they represent
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

  try {
    const engagement = await fetchCiqEngagementRate(athlete.creatoriq_publisher_id);
    if (!engagement.ok) {
      return NextResponse.json({ error: engagement.error }, { status: 502 });
    }

    const serviceSupabase = await createServiceRoleClient();
    const { data, error } = await serviceSupabase
      .from("ciq_engagement_rate_snapshots")
      .insert({
        athlete_id,
        publisher_id: athlete.creatoriq_publisher_id,
        social_id: null,
        network: null,
        start_date: engagement.startDate,
        end_date: engagement.endDate,
        metrics: engagement.metrics,
        raw: engagement.report,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("[CIQ] Failed to insert engagement snapshot", error);
      return NextResponse.json(
        { error: "Failed to save engagement rate snapshot" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      snapshot_id: data.id,
      created_at: data.created_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh engagement rate";
    console.error("[CIQ] engagement-rate refresh error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

