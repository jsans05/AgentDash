import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { normalizePipelineContacts } from "@/lib/crm/pipeline-contacts";
import { fetchPipelineCardById } from "@/lib/features/crm-pipeline/service";
import { NextResponse } from "next/server";

const PIPELINE_STAGES = new Set([
  "target",
  "research",
  "drafting",
  "outreach",
  "follow_up",
  "ghost",
  "in_progress",
  "closed",
]);

const PATCH_KEYS = new Set([
  "pipeline_stage",
  "idea_notes",
  "company_description",
  "personal_notes",
  "past_partnerships",
  "instagram_handle",
  "website_url",
  "support_email_v2",
  "pipeline_contacts",
  "potential_athletes",
  "todos",
  "closed_value",
  "closed_athlete_id",
  "closed_media_url",
  "draft_messages",
  "responded_at",
  "outreach_at",
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { data: current, error: curErr } = await supabase
    .from("crm_companies_pipeline")
    .select("*")
    .eq("id", id)
    .single();

  if (curErr || !current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (current.created_by_user_id !== profile.user_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const companyPatch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "company_name")) {
    const name = String((body as { company_name?: unknown }).company_name ?? "").trim();
    if (name) companyPatch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "product_category")) {
    const v = (body as { product_category?: unknown }).product_category;
    companyPatch.product_category = v == null || String(v).trim() === "" ? null : String(v).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "managed_by_agency")) {
    companyPatch.managed_by_agency = Boolean((body as { managed_by_agency?: unknown }).managed_by_agency);
    if (!companyPatch.managed_by_agency) {
      companyPatch.agency_name = null;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "agency_name") &&
    (body as { managed_by_agency?: unknown }).managed_by_agency !== false
  ) {
    const v = (body as { agency_name?: unknown }).agency_name;
    companyPatch.agency_name = v == null || String(v).trim() === "" ? null : String(v).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "hq_phone")) {
    const v = (body as { hq_phone?: unknown }).hq_phone;
    companyPatch.hq_phone = v == null || String(v).trim() === "" ? null : String(v).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "company_website")) {
    const v = (body as { company_website?: unknown }).company_website;
    companyPatch.website = v == null || String(v).trim() === "" ? null : String(v).trim();
  }

  if (Object.keys(companyPatch).length > 0) {
    const { error: coErr } = await supabaseAdmin
      .from("companies")
      .update(companyPatch)
      .eq("company_id", current.company_id);
    if (coErr) {
      return NextResponse.json({ error: coErr.message }, { status: 500 });
    }
  }

  const updates: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key as keyof typeof body] === undefined) continue;
    if (key === "pipeline_contacts") {
      updates.pipeline_contacts = normalizePipelineContacts(body.pipeline_contacts);
    } else {
      updates[key] = body[key as keyof typeof body];
    }
  }

  if (updates.pipeline_stage !== undefined) {
    const stage = String(updates.pipeline_stage);
    if (!PIPELINE_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid pipeline_stage" }, { status: 400 });
    }
    updates.pipeline_stage = stage;
  }

  if (
    updates.pipeline_stage === "outreach" &&
    !current.outreach_at &&
    !Object.prototype.hasOwnProperty.call(body, "outreach_at")
  ) {
    updates.outreach_at = new Date().toISOString();
  }

  if (
    updates.pipeline_stage === "in_progress" &&
    !current.responded_at &&
    !Object.prototype.hasOwnProperty.call(body, "responded_at")
  ) {
    updates.responded_at = new Date().toISOString();
  }

  if (Object.keys(updates).length === 0 && Object.keys(companyPatch).length === 0) {
    const card = await fetchPipelineCardById(supabase, id);
    return NextResponse.json({ card });
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await supabase.from("crm_companies_pipeline").update(updates).eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  try {
    const cardOut = await fetchPipelineCardById(supabase, id);
    return NextResponse.json({ card: cardOut });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load card";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await params;

  const { data: current, error: curErr } = await supabase
    .from("crm_companies_pipeline")
    .select("id, created_by_user_id")
    .eq("id", id)
    .single();

  if (curErr || !current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (current.created_by_user_id !== profile.user_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("crm_companies_pipeline").update({ archived: true }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
