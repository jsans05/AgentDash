import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { fetchCrmListTargetListRows } from "@/lib/crm/crm-list-target-list-server";
import { enrichTargetListRowsWithAgencyActivity } from "@/lib/crm/company-cross-agent-activity-server";
import { removeCompanyFromCrmList } from "@/lib/crm/crm-lists-server";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createServerClient();
  try {
    const rows = await fetchCrmListTargetListRows(supabase, id, profile.user_id);
    const enriched = await enrichTargetListRowsWithAgencyActivity(rows, profile.user_id);
    return NextResponse.json({ rows: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load list";
    const status = msg === "List not found" ? 404 : msg === "Unauthorized" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id")?.trim();
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  try {
    await removeCompanyFromCrmList(supabase, id, companyId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to remove company from list";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
