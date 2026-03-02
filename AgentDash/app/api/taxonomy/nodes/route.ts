import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { resolveSportToCanonical } from "@/lib/taxonomy";
import { NextResponse } from "next/server";

/**
 * GET /api/taxonomy/nodes?sport=Surf
 * Returns full taxonomy nodes (with IDs) for a sport. Used for exclusivity editor and prospecting category switches.
 * Resolves roster sport (e.g. "Motorsports/Two Wheel - Supercross/Motocross") to canonical taxonomy sport ("Supercross / Motocross (Moto)").
 */
export async function GET(req: Request) {
  await requireProfile();
  const { searchParams } = new URL(req.url);
  const sportParam = searchParams.get("sport")?.trim() || null;

  if (!sportParam) {
    return NextResponse.json({ error: "sport parameter required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const sport = resolveSportToCanonical(sportParam) ?? sportParam;

  const { data, error } = await supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order")
    .eq("sport", sport)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
