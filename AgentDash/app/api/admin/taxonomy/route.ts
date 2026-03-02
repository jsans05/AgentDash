import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET /api/admin/taxonomy – list all taxonomy rows (optional ?sport= filter). */
export async function GET(req: Request) {
  await requireRole("admin");
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport")?.trim() || null;

  const supabase = await createServerClient();
  let query = supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order, is_active, created_at")
    .order("sport")
    .order("sort_order", { ascending: true });

  if (sport) query = query.eq("sport", sport);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

/** POST /api/admin/taxonomy – create one taxonomy row. */
export async function POST(req: Request) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const sport = body.sport?.trim();
  const tier = body.tier === "ENDEMIC" || body.tier === "NON_ENDEMIC" ? body.tier : null;
  const category = body.category?.trim();
  const sort_order = typeof body.sort_order === "number" ? body.sort_order : 0;
  const is_active = body.is_active !== false;

  if (!sport || !tier || !category) {
    return NextResponse.json(
      { error: "sport, tier (ENDEMIC|NON_ENDEMIC), and category are required" },
      { status: 400 }
    );
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
