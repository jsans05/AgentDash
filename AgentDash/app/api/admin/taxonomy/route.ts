import { requireRole } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
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

    if (error) return internalServerError(error, "admin-taxonomy:get:sports");
    const set = new Set((data ?? []).map((r) => r.sport).filter(Boolean));
    return NextResponse.json([...set].sort((a, b) => a.localeCompare(b)));
  }

  const baseSelect =
    "id, sport, tier, category, sort_order, is_active, created_at, parent_id, is_group" as const;

  if (sport === TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT) {
    const { data: globalRows, error: globalErr } = await supabase
      .from("sponsorship_taxonomies")
      .select(baseSelect)
      .eq("sport", TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT)
      .order("sort_order", { ascending: true });

    if (globalErr) return internalServerError(globalErr, "admin-taxonomy:get:global");

    if (globalRows?.length) {
      return NextResponse.json(globalRows);
    }

    const trySports = ["Surf", "Supercross / Motocross (Moto)", "Four Wheel Offroad"];
    for (const refSport of trySports) {
      const { data: legacy, error: legErr } = await supabase
        .from("sponsorship_taxonomies")
        .select(baseSelect)
        .eq("sport", refSport)
        .eq("tier", "NON_ENDEMIC")
        .order("sort_order", { ascending: true });
      if (legErr) return internalServerError(legErr, "admin-taxonomy:get:legacy-sport");
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

    if (sportErr) return internalServerError(sportErr, "admin-taxonomy:get:any-sport");

    if (anySport?.sport) {
      const { data: legacy, error: legErr } = await supabase
        .from("sponsorship_taxonomies")
        .select(baseSelect)
        .eq("sport", anySport.sport)
        .eq("tier", "NON_ENDEMIC")
        .order("sort_order", { ascending: true });
      if (legErr) return internalServerError(legErr, "admin-taxonomy:get:legacy-fallback");
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

  if (error) return internalServerError(error, "admin-taxonomy:get:list");
  return NextResponse.json(data ?? []);
}

/** POST /api/admin/taxonomy — create one taxonomy row. NON_ENDEMIC always uses the global sport bucket. */
export async function POST(req: Request) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const tier = body.tier === "ENDEMIC" || body.tier === "NON_ENDEMIC" ? body.tier : null;
  const category = body.category?.trim();
  const is_active = body.is_active !== false;
  const is_group = Boolean(body.is_group);
  const parent_id =
    typeof body.parent_id === "string" && body.parent_id.trim() ? body.parent_id.trim() : null;

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

  if (parent_id) {
    const { data: parentRow, error: parentErr } = await supabase
      .from("sponsorship_taxonomies")
      .select("id, sport, tier, is_group")
      .eq("id", parent_id)
      .single();
    if (parentErr || !parentRow) {
      return NextResponse.json({ error: "Parent group not found" }, { status: 400 });
    }
    if (!parentRow.is_group) {
      return NextResponse.json({ error: "parent_id must reference a group row" }, { status: 400 });
    }
    if (parentRow.sport !== sport || parentRow.tier !== tier) {
      return NextResponse.json(
        { error: "Child must share sport and tier with its parent group" },
        { status: 400 }
      );
    }
  }

  if (is_group && parent_id) {
    return NextResponse.json({ error: "Groups cannot be nested inside another group" }, { status: 400 });
  }

  let sort_order: number;
  if (typeof body.sort_order === "number") {
    sort_order = body.sort_order;
  } else {
    let maxQuery = supabase
      .from("sponsorship_taxonomies")
      .select("sort_order")
      .eq("sport", sport)
      .eq("tier", tier)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (parent_id) maxQuery = maxQuery.eq("parent_id", parent_id);
    else maxQuery = maxQuery.is("parent_id", null);
    const { data: maxRow } = await maxQuery.maybeSingle();
    sort_order = (maxRow?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("sponsorship_taxonomies")
    .insert({ sport, tier, category, sort_order, is_active, is_group, parent_id })
    .select()
    .single();

  if (error) return internalServerError(error, "admin-taxonomy:post");
  return NextResponse.json(data);
}
