import { NextResponse } from "next/server";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { fetchAthleteTargetListRows } from "@/lib/crm/athlete-target-list-server";
import type { TargetListContact, TargetListRow } from "@/lib/crm/athlete-target-list";
import { enrichTargetListRowsWithAgencyActivity } from "@/lib/crm/company-cross-agent-activity-server";
import { removeAthleteFromTargetListCard } from "@/lib/crm/remove-athlete-from-target-list";
import { importAthleteTargetListRows } from "@/lib/crm/import-athlete-target-list";
import { normalizeJsonImportRow } from "@/lib/consulting/import-target-list";

export type { TargetListContact, TargetListRow };

async function assertAthleteTargetListAccess(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: { role: string; user_id: string },
  athleteId: string
): Promise<NextResponse | null> {
  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }
  return null;
}

/**
 * GET /api/athletes/:id/target-list
 *
 * Returns the shared spreadsheet-ready target list for an athlete: every
 * non-archived pipeline card (any teammate) where the athlete appears in
 * `potential_athletes`, with owner info and that owner's contacts.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  const denied = await assertAthleteTargetListAccess(supabase, profile, athleteId);
  if (denied) return denied;

  try {
    const rows = await fetchAthleteTargetListRows(supabase, profile.user_id, athleteId);
    const enriched = await enrichTargetListRowsWithAgencyActivity(rows, profile.user_id);
    return NextResponse.json({ rows: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to load target list" }, { status: 500 });
  }
}

/**
 * POST /api/athletes/:id/target-list
 *
 * Manually add a single company (and optional category/website) to this
 * athlete's target list on the caller's pipeline card.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  const denied = await assertAthleteTargetListAccess(supabase, profile, athleteId);
  if (denied) return denied;

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
    const supabaseAdmin = await createServiceRoleClient();
    const { data: athleteRow, error: athleteErr } = await supabaseAdmin
      .from("athletes")
      .select("athlete_id, first_name, last_name, sport")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (athleteErr) throw new Error(athleteErr.message);
    if (!athleteRow) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    const athleteName = [athleteRow.first_name, athleteRow.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    const summary = await importAthleteTargetListRows(supabaseAdmin, {
      userId: profile.user_id,
      athlete: {
        athlete_id: athleteId,
        name: athleteName,
        sport: athleteRow.sport ?? null,
      },
      rows: [importRow],
    });
    if (summary.row_errors.length > 0) {
      return NextResponse.json({ error: summary.row_errors[0] }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      companies: summary.companies,
      cards_created: summary.cards_created,
      cards_updated: summary.cards_updated,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to add company";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/athletes/:id/target-list
 *
 * Removes this athlete from a pipeline card's potential_athletes (company stays in CRM).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  const denied = await assertAthleteTargetListAccess(supabase, profile, athleteId);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const pipelineId = String((body as { pipeline_id?: unknown }).pipeline_id ?? "").trim();
  if (!pipelineId) {
    return NextResponse.json({ error: "pipeline_id is required" }, { status: 400 });
  }

  const result = await removeAthleteFromTargetListCard(
    supabase,
    profile.user_id,
    athleteId,
    pipelineId
  );
  if (!result.ok) {
    const status = result.error === "Not your pipeline card" ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, pipeline_id: pipelineId });
}
