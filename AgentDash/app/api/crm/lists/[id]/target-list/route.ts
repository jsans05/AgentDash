import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchCrmListTargetListRows } from "@/lib/crm/crm-list-target-list-server";
import { enrichTargetListRowsWithAgencyActivity } from "@/lib/crm/company-cross-agent-activity-server";
import { assertCrmListOwner, removeCompanyFromCrmList } from "@/lib/crm/crm-lists-server";
import { importCrmProspectRows } from "@/lib/crm/import-crm-prospect-list";
import { normalizeJsonImportRow } from "@/lib/consulting/import-target-list";

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

/**
 * POST /api/crm/lists/:id/target-list
 *
 * Manually add a single company (and optional category/website) to this CRM list.
 * Creates/updates the caller's pipeline card and list membership.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const { id: listId } = await params;
  const supabaseAdmin = await createServiceRoleClient();
  try {
    await assertCrmListOwner(supabaseAdmin, listId, profile.user_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List not found";
    const status = msg === "Unauthorized" ? 403 : 404;
    return NextResponse.json({ error: msg }, { status });
  }

  const body = await req.json().catch(() => ({}));
  const companyName = String(
    (body as { company_name?: unknown }).company_name ?? ""
  ).trim();
  if (!companyName) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const industryCategory =
    (body as { industry_category?: unknown; category?: unknown }).industry_category != null
      ? String((body as { industry_category?: unknown }).industry_category).trim() || null
      : (body as { category?: unknown }).category != null
        ? String((body as { category?: unknown }).category).trim() || null
        : null;

  const importRow = normalizeJsonImportRow({
    company_name: companyName,
    industry_category: industryCategory,
    website: (body as { website?: unknown }).website,
    match_score: (body as { match_score?: unknown }).match_score,
    company_description: (body as { company_description?: unknown }).company_description,
    personal_notes: (body as { personal_notes?: unknown }).personal_notes,
    hq_phone: (body as { hq_phone?: unknown }).hq_phone,
  });
  if (!importRow) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  try {
    const summary = await importCrmProspectRows(supabaseAdmin, {
      userId: profile.user_id,
      rows: [importRow],
      listId,
    });
    if (summary.row_errors.length > 0 && summary.companies === 0) {
      return NextResponse.json({ error: summary.row_errors[0] }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      companies: summary.companies,
      cards_created: summary.cards_created,
      cards_updated: summary.cards_updated,
      members_added: summary.members_added,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to add company";
    return NextResponse.json({ error: msg }, { status: 500 });
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
