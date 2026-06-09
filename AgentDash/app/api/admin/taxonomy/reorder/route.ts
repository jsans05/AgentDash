import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * PUT /api/admin/taxonomy/reorder
 * Body: { ordered_ids: string[] } — sets sort_order 0..n-1 for each id in order.
 */
export async function PUT(req: Request) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const orderedIds = Array.isArray(body.ordered_ids)
    ? body.ordered_ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (orderedIds.length === 0) {
    return NextResponse.json({ error: "ordered_ids is required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const updates = orderedIds.map((id: string, index: number) =>
    supabase.from("sponsorship_taxonomies").update({ sort_order: index }).eq("id", id)
  );

  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: orderedIds.length });
}
