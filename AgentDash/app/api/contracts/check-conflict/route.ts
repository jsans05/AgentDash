import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Check if a proposed contract would conflict with existing contracts in the same category.
 * Query params: athlete_id, category (text category from taxonomy)
 */
export async function GET(req: Request) {
  await requireProfile();
  const { searchParams } = new URL(req.url);
  const athleteId = searchParams.get("athlete_id");
  const category = searchParams.get("category")?.trim();

  if (!athleteId || !category) {
    return NextResponse.json({ error: "Missing athlete_id or category" }, { status: 400 });
  }

  const supabase = await createServerClient();

  const { data: conflicts } = await supabase
    .from("contracts")
    .select("*, companies(*)")
    .eq("athlete_id", athleteId)
    .eq("category", category)
    .eq("archived", false)
    .eq("status", "active");

  return NextResponse.json({
    hasConflict: (conflicts?.length ?? 0) > 0,
    conflicts: conflicts ?? [],
  });
}
