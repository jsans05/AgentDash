import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { fetchMyAthletes } from "@/lib/athletes/accessible";
import { NextResponse } from "next/server";

/**
 * GET /api/my-athletes
 * Athletes the current user can add brands/contacts to.
 */
export async function GET() {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();

  try {
    const athletes = await fetchMyAthletes(supabase, profile);
    return NextResponse.json({ athletes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load athletes" },
      { status: 500 }
    );
  }
}
