import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireConsultingProfileAccess, ConsultingAccessError } from "@/lib/consulting/access";

type RouteParams = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  const { id: consultingProfileId, entryId } = await params;
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
  const patch: Record<string, unknown> = {};
  const companyPatch: Record<string, string | null> = {};

  if (body.industry_category !== undefined) {
    patch.industry_category =
      body.industry_category == null ? null : String(body.industry_category).trim() || null;
  }
  if (body.match_score !== undefined) {
    if (body.match_score == null || body.match_score === "") {
      patch.match_score = null;
    } else {
      const n = Number(body.match_score);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Invalid match_score" }, { status: 400 });
      }
      patch.match_score = n;
    }
  }
  if (body.company_description !== undefined) {
    patch.company_description =
      body.company_description == null ? null : String(body.company_description);
  }
  if (body.personal_notes !== undefined) {
    patch.personal_notes = body.personal_notes == null ? null : String(body.personal_notes);
  }
  if (body.company_website !== undefined) {
    companyPatch.website =
      body.company_website == null ? null : String(body.company_website).trim() || null;
  }
  if (body.hq_phone !== undefined) {
    companyPatch.hq_phone =
      body.hq_phone == null ? null : String(body.hq_phone).trim() || null;
  }
  if (body.company_name !== undefined) {
    const name = String(body.company_name).trim();
    if (!name) {
      return NextResponse.json({ error: "company_name cannot be empty" }, { status: 400 });
    }
    companyPatch.name = name;
  }

  if (Object.keys(patch).length === 0 && Object.keys(companyPatch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: entryRow, error: entryLookupErr } = await supabase
    .from("consulting_target_list")
    .select("id, company_id")
    .eq("id", entryId)
    .eq("consulting_profile_id", consultingProfileId)
    .maybeSingle();
  if (entryLookupErr) return NextResponse.json({ error: entryLookupErr.message }, { status: 500 });
  if (!entryRow) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  if (Object.keys(companyPatch).length > 0) {
    const supabaseAdmin = await createServiceRoleClient();
    const { error: companyErr } = await supabaseAdmin
      .from("companies")
      .update(companyPatch)
      .eq("company_id", entryRow.company_id);
    if (companyErr) return NextResponse.json({ error: companyErr.message }, { status: 500 });
  }

  let data = entryRow;
  if (Object.keys(patch).length > 0) {
    const { data: updated, error } = await supabase
      .from("consulting_target_list")
      .update(patch)
      .eq("id", entryId)
      .eq("consulting_profile_id", consultingProfileId)
      .select("id, industry_category, match_score, company_description, personal_notes")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = { ...data, ...updated };
  }

  if (patch.industry_category !== undefined && entryRow.company_id && patch.industry_category) {
    const supabaseAdmin = await createServiceRoleClient();
    await supabaseAdmin
      .from("companies")
      .update({ product_category: patch.industry_category })
      .eq("company_id", entryRow.company_id);
  }

  return NextResponse.json({ entry: data });
}
