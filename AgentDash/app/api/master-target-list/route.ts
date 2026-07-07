import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { enrichTargetListRowsWithAgencyActivity } from "@/lib/crm/company-cross-agent-activity-server";
import { fetchMasterTargetListRows } from "@/lib/crm/master-target-list";
import { getRosterAthleteIdsForProfile } from "@/lib/ai/roster-audience";

export async function GET() {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();

  try {
    const rosterAthleteIds = await getRosterAthleteIdsForProfile(supabase, profile);
    const rows = await fetchMasterTargetListRows(supabase, profile.user_id, rosterAthleteIds);
    const enriched = await enrichTargetListRowsWithAgencyActivity(rows, profile.user_id);
    return NextResponse.json({ rows: enriched });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load master target list";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
