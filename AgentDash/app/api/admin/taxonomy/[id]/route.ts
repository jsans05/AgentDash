import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** PATCH /api/admin/taxonomy/[id] – update one row. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (body.category !== undefined) updates.category = String(body.category).trim();
  if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
  if (body.tier !== undefined) {
    if (body.tier !== "ENDEMIC" && body.tier !== "NON_ENDEMIC") {
      return NextResponse.json({ error: "tier must be ENDEMIC or NON_ENDEMIC" }, { status: 400 });
    }
    updates.tier = body.tier;
  }
  if (body.sport !== undefined) updates.sport = String(body.sport).trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = await createServerClient();
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
