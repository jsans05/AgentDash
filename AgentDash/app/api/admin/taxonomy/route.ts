import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";
import { NextResponse } from "next/server";

/**
 * GET /api/admin/taxonomy
 * - ?sports_only=1 — distinct sport names that have ENDEMIC rows (for filters / datalist).
 * - ?sport=X — filter rows for that sport (exact sport column).
 * - default — all rows.
 */
export async function GET(req: Request) {
  await requireRole("admin");
  const { searchParams } = new URL(req.url);
  const sportsOnly = searchParams.get("sports_only") === "1";
  const sport = searchParams.get("sport")?.trim() || null;

  const supabase = await createServerClient();

  if (sportsOnly) {
    const { data, error } = await supabase
      .from("sponsorship_taxonomies")
      .select("sport")
      .eq("tier", "ENDEMIC")
      .neq("sport", TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const set = new Set((data ?? []).map((r) => r.sport).filter(Boolean));
    return NextResponse.json([...set].sort((a, b) => a.localeCompare(b)));
  }

  const baseSelect =
    "id, sport, tier, category, sort_order, is_active, created_at" as const;

  if (sport === TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT) {
    const { data: globalRows, error: globalErr } = await supabase
      .from("sponsorship_taxonomies")
      .select(baseSelect)
      .eq("sport", TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT)
      .order("sort_order", { ascending: true });

    if (globalErr) {
      return NextResponse.json({ error: globalErr.message }, { status: 500 });
    }

    if (globalRows?.length) {
      return NextResponse.json(globalRows);
    }

    const trySports = ["Surf", "Supercross / Motocross (Moto)", "Racing / Motorsports"];
    for (const refSport of trySports) {
      const { data: legacy, error: legErr } = await supabase
        .from("sponsorship_taxonomies")
        .select(baseSelect)
        .eq("sport", refSport)
        .eq("tier", "NON_ENDEMIC")
        .order("sort_order", { ascending: true });
      if (legErr) {
        return NextResponse.json({ error: legErr.message }, { status: 500 });
      }
      if (legacy?.length) {
        return NextResponse.json(legacy, {
          headers: { "X-Taxonomy-Global-Legacy": "1" },
        });
      }
    }

    const { data: anySport, error: sportErr } = await supabase
      .from("sponsorship_taxonomies")
      .select("sport")
      .eq("tier", "NON_ENDEMIC")
      .neq("sport", TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT)
      .limit(1)
      .maybeSingle();

    if (sportErr) {
      return NextResponse.json({ error: sportErr.message }, { status: 500 });
    }

    if (anySport?.sport) {
      const { data: legacy, error: legErr } = await supabase
        .from("sponsorship_taxonomies")
        .select(baseSelect)
        .eq("sport", anySport.sport)
        .eq("tier", "NON_ENDEMIC")
        .order("sort_order", { ascending: true });
      if (legErr) {
        return NextResponse.json({ error: legErr.message }, { status: 500 });
      }
      if (legacy?.length) {
        return NextResponse.json(legacy, {
          headers: { "X-Taxonomy-Global-Legacy": "1" },
        });
      }
    }

    return NextResponse.json([]);
  }

  let query = supabase
    .from("sponsorship_taxonomies")
    .select(baseSelect)
    .order("sport")
    .order("sort_order", { ascending: true });

  if (sport) query = query.eq("sport", sport);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

/** POST /api/admin/taxonomy — create one taxonomy row. NON_ENDEMIC always uses the global sport bucket. */
export async function POST(req: Request) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const tier = body.tier === "ENDEMIC" || body.tier === "NON_ENDEMIC" ? body.tier : null;
  const category = body.category?.trim();
  const sort_order = typeof body.sort_order === "number" ? body.sort_order : 0;
  const is_active = body.is_active !== false;

  if (!tier || !category) {
    return NextResponse.json(
      { error: "tier (ENDEMIC|NON_ENDEMIC) and category are required" },
      { status: 400 }
    );
  }

  let sport: string;
  if (tier === "NON_ENDEMIC") {
    sport = TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT;
  } else {
    sport = body.sport?.trim();
    if (!sport || sport === TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT) {
      return NextResponse.json(
        { error: "ENDEMIC rows require a real sport name (not the global non-endemic bucket)" },
        { status: 400 }
      );
    }
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("sponsorship_taxonomies")
    .insert({ sport, tier, category, sort_order, is_active })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
