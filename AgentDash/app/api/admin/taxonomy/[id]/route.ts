import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT } from "@/lib/taxonomy-constants";
import { NextResponse } from "next/server";

/** PATCH /api/admin/taxonomy/[id] – update one row. NON_ENDEMIC rows always keep the global sport key. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const supabase = await createServerClient();
  const { data: existing, error: existingError } = await supabase
    .from("sponsorship_taxonomies")
    .select("tier, sport")
    .eq("id", id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Taxonomy row not found" }, { status: 404 });
  }

  let nextTier: "ENDEMIC" | "NON_ENDEMIC" = existing.tier as "ENDEMIC" | "NON_ENDEMIC";
  if (body.tier !== undefined) {
    if (body.tier !== "ENDEMIC" && body.tier !== "NON_ENDEMIC") {
      return NextResponse.json({ error: "tier must be ENDEMIC or NON_ENDEMIC" }, { status: 400 });
    }
    nextTier = body.tier;
  }

  let nextSport = body.sport !== undefined ? String(body.sport).trim() : existing.sport;

  if (existing.tier === "NON_ENDEMIC" && nextTier === "ENDEMIC") {
    if (body.sport === undefined || !String(body.sport).trim()) {
      return NextResponse.json(
        { error: "Changing from non-endemic to endemic requires a sport" },
        { status: 400 }
      );
    }
    nextSport = String(body.sport).trim();
  }

  if (nextTier === "NON_ENDEMIC") {
    nextSport = TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT;
  } else if (!nextSport || nextSport === TAXONOMY_NON_ENDEMIC_GLOBAL_SPORT) {
    return NextResponse.json(
      { error: "ENDEMIC rows require a real sport (not the global non-endemic bucket)" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {
    tier: nextTier,
    sport: nextSport,
  };
  if (body.category !== undefined) updates.category = String(body.category).trim();
  if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

  const { data, error } = await supabase
    .from("sponsorship_taxonomies")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/** DELETE /api/admin/taxonomy/[id] – delete one row. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");
  const { id } = await params;

  const supabase = await createServerClient();
  const { error } = await supabase.from("sponsorship_taxonomies").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
