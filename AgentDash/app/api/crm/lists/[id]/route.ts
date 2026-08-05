import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { assertCrmListOwner } from "@/lib/crm/crm-lists-server";
import { fetchCrmListCompanyIds } from "@/lib/crm/crm-list-target-list-server";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createServerClient();
  try {
    const list = await assertCrmListOwner(supabase, id, profile.user_id);
    const company_ids = await fetchCrmListCompanyIds(supabase, id, profile.user_id);
    return NextResponse.json({ list, company_ids });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load list";
    const status = msg === "List not found" ? 404 : msg === "Unauthorized" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const supabase = await createServerClient();

  try {
    await assertCrmListOwner(supabase, id, profile.user_id);
    const patch: Record<string, unknown> = {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "List name cannot be blank" }, { status: 400 });
      patch.name = name;
    }
    if (body.description !== undefined) {
      patch.description = body.description ? String(body.description).trim() : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }

    const { data, error } = await supabase.from("crm_lists").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ list: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update list";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createServerClient();
  try {
    await assertCrmListOwner(supabase, id, profile.user_id);
    const { error } = await supabase.from("crm_lists").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete list";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
