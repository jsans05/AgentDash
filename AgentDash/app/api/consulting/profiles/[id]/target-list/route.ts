import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireConsultingProfileAccess, ConsultingAccessError } from "@/lib/consulting/access";
import {
  normalizeJsonImportRow,
  upsertConsultingTargetListRows,
  type ConsultingTargetListImportRow,
} from "@/lib/consulting/import-target-list";
import { fetchConsultingTargetListRows } from "@/lib/crm/consulting-target-list";
import { enrichTargetListRowsWithAgencyActivity } from "@/lib/crm/company-cross-agent-activity-server";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    await requireConsultingProfileAccess(supabase, profile, id);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  try {
    const rows = await fetchConsultingTargetListRows(supabase, id);
    const enriched = await enrichTargetListRowsWithAgencyActivity(rows, profile.user_id);
    return NextResponse.json({ rows: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load target list";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  const { id: consultingProfileId } = await params;
  const supabase = await createServerClient();

  try {
    await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));

  if (Array.isArray(body.companies)) {
    const supabaseAdmin = await createServiceRoleClient();
    const rows = body.companies
      .map((raw: Record<string, unknown>) => normalizeJsonImportRow(raw))
      .filter((r: ConsultingTargetListImportRow | null): r is ConsultingTargetListImportRow => r != null);
    const summary = await upsertConsultingTargetListRows(supabaseAdmin, {
      consultingProfileId,
      userId: profile.user_id,
      rows,
    });
    return NextResponse.json({
      added: summary.companies_upserted,
      skipped: summary.skipped,
      contacts_inserted: summary.contacts_inserted,
      contacts_updated: summary.contacts_updated,
      row_errors: summary.row_errors,
    });
  }

  const companyName = String(body.company_name ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const industryCategory =
    body.industry_category != null ? String(body.industry_category).trim() || null : null;
  const supabaseAdmin = await createServiceRoleClient();
  const importRow = normalizeJsonImportRow({
    company_name: body.company_name,
    industry_category: industryCategory,
    website: body.website,
    match_score: body.match_score,
    company_description: body.company_description,
    personal_notes: body.personal_notes,
    hq_phone: body.hq_phone,
    first_name: body.first_name,
    last_name: body.last_name,
    role: body.role,
    title: body.title,
    email: body.email,
    contact: body.contact,
  });
  if (!importRow) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const summary = await upsertConsultingTargetListRows(supabaseAdmin, {
    consultingProfileId,
    userId: profile.user_id,
    rows: [importRow],
  });
  if (summary.row_errors.length > 0) {
    return NextResponse.json({ error: summary.row_errors[0] }, { status: 500 });
  }

  const rows = await fetchConsultingTargetListRows(supabaseAdmin, consultingProfileId);
  const companyId = (
    await supabaseAdmin
      .from("companies")
      .select("company_id")
      .eq("name", importRow.company_name)
      .maybeSingle()
  ).data?.company_id;
  const row = rows.find((r) => r.company_id === companyId);
  return NextResponse.json({ entry: row ?? { company_name: importRow.company_name } });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  const { id: consultingProfileId } = await params;
  const supabase = await createServerClient();

  try {
    await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const entryId = String(body.entry_id ?? body.pipeline_id ?? "").trim();
  if (!entryId) {
    return NextResponse.json({ error: "entry_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("consulting_target_list")
    .delete()
    .eq("id", entryId)
    .eq("consulting_profile_id", consultingProfileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
