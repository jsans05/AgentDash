import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { fetchTaxonomyNodesForSport } from "@/lib/taxonomy";
import { NextResponse } from "next/server";

/**
 * GET /api/taxonomy/nodes?sport=Surf
 * Returns full taxonomy nodes (with IDs) for a sport. Used for exclusivity editor and prospecting category switches.
 * Resolves roster sport (e.g. "Motorsports/Two Wheel - Supercross/Motocross") to canonical taxonomy sport for ENDEMIC rows and appends global NON_ENDEMIC.
 *
 * If `sport` is omitted, returns all active nodes (every sport ENDEM + one global NON_ENDEMIC set).
 */
export async function GET(req: Request) {
  await requireNonAccounting();
  const { searchParams } = new URL(req.url);
  const sportParam = searchParams.get("sport")?.trim() || null;

  if (sportParam) {
    const nodes = await fetchTaxonomyNodesForSport(sportParam);
    return NextResponse.json(nodes);
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order, parent_id, is_group")
    .eq("is_active", true)
    .order("sport", { ascending: true })
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
