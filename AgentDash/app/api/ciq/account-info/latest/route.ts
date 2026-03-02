import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const profile = await requireProfile();
  const url = new URL(req.url);
  const athlete_id = url.searchParams.get("athleteId");

  if (!athlete_id) {
    return NextResponse.json({ error: "athleteId required" }, { status: 400 });
  }

  const supabase = await createServerClient();

  // Access: agent can only see athletes they represent
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

  const { data, error } = await supabase
    .from("ciq_account_info_snapshots")
    .select(
      "id, athlete_id, publisher_id, network, account_handle, account_url, ciq_account_id, metrics, raw, created_at"
    )
    .eq("athlete_id", athlete_id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[CIQ] account-info latest error", error);
    return NextResponse.json({ error: "Failed to load accountInfo snapshots" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ snapshots: [] });
  }

  // Deduplicate to latest per (network, account_handle || account_url)
  const seen = new Set<string>();
  const latestPerAccount = [];
  for (const row of data) {
    const key = `${row.network ?? ""}:${row.account_handle ?? row.account_url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latestPerAccount.push(row);
  }

  return NextResponse.json({ snapshots: latestPerAccount });
}

