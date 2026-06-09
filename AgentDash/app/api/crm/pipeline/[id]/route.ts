import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { normalizePipelineContacts } from "@/lib/crm/pipeline-contacts";
import { setMatchScoreForAthlete } from "@/lib/crm/potential-athletes";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";
import { fetchPipelineCardById } from "@/lib/features/crm-pipeline/service";
import { NextResponse } from "next/server";

function potentialAthletesAdded(
  prev: unknown,
  next: unknown
): boolean {
  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  const prevIds = new Set(
    prevList.map((p) => String((p as { athlete_id?: string })?.athlete_id ?? "")).filter(Boolean)
  );
  return nextList.some((p) => {
    const id = String((p as { athlete_id?: string })?.athlete_id ?? "");
    return id && !prevIds.has(id);
  });
}

import {
  markDraftSent,
  mergeDraftMessagesPreservingSentAt,
} from "@/lib/crm/draft-messages";
import {
  normalizePipelineStage,
  pipelineStageToFunnel,
  PIPELINE_STAGES,
} from "@/lib/crm/stage-map";

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
  "outreach_email_subject",
  "outreach_email",
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
  const markDraftSentAt = Object.prototype.hasOwnProperty.call(body, "mark_draft_sent")
    ? String((body as { mark_draft_sent?: unknown }).mark_draft_sent ?? "").trim()
    : "";

  if (
    Object.prototype.hasOwnProperty.call(body, "athlete_match_score") &&
    Object.prototype.hasOwnProperty.call(body, "athlete_id")
  ) {
    const athleteId = String((body as { athlete_id?: unknown }).athlete_id ?? "").trim();
    if (!athleteId) {
      return NextResponse.json({ error: "athlete_id is required with athlete_match_score" }, { status: 400 });
    }
    const rawScore = (body as { athlete_match_score?: unknown }).athlete_match_score;
    let matchScore: number | null = null;
    if (rawScore != null && String(rawScore).trim() !== "") {
      const n = Number(rawScore);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Invalid athlete_match_score" }, { status: 400 });
      }
      matchScore = n;
    }
    updates.potential_athletes = setMatchScoreForAthlete(current.potential_athletes, athleteId, matchScore);
  }

  for (const key of PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key) || body[key as keyof typeof body] === undefined) continue;
    if (key === "pipeline_contacts") {
      updates.pipeline_contacts = normalizePipelineContacts(body.pipeline_contacts);
    } else if (key === "draft_messages") {
      updates.draft_messages = mergeDraftMessagesPreservingSentAt(
        current.draft_messages,
        body.draft_messages
      );
    } else {
      updates[key] = body[key as keyof typeof body];
    }
  }

  if (markDraftSentAt) {
    const base = Array.isArray(updates.draft_messages)
      ? updates.draft_messages
      : current.draft_messages;
    updates.draft_messages = markDraftSent(
      mergeDraftMessagesPreservingSentAt(current.draft_messages, base) as Parameters<
        typeof markDraftSent
      >[0],
      markDraftSentAt
    );
  }

  if (updates.pipeline_stage !== undefined) {
    const stage = String(updates.pipeline_stage);
    if (!PIPELINE_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid pipeline_stage" }, { status: 400 });
    }
    const normalizedStage = normalizePipelineStage(stage);
    updates.pipeline_stage = normalizedStage;
    updates.funnel_stage = pipelineStageToFunnel(normalizedStage);
    // #region agent log
    fetch("http://127.0.0.1:7310/ingest/3db61d27-132c-4ea5-8254-c4515c90a750", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a18aef" },
      body: JSON.stringify({
        sessionId: "a18aef",
        runId: "post-fix",
        hypothesisId: "P1-B",
        location: "pipeline/[id]/route.ts:stage-sync",
        message: "pipeline stage update with funnel sync",
        data: {
          cardId: id,
          pipeline_stage: normalizedStage,
          funnel_stage: updates.funnel_stage,
          prior_funnel_stage: current.funnel_stage ?? null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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

  if (
    Object.keys(updates).length === 0 &&
    Object.keys(companyPatch).length === 0 &&
    !markDraftSentAt
  ) {
    const card = await fetchPipelineCardById(supabase, id);
    return NextResponse.json({ card });
  }

  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await supabase.from("crm_companies_pipeline").update(updates).eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "potential_athletes") &&
    potentialAthletesAdded(current.potential_athletes, body.potential_athletes)
  ) {
    const { data: companyRow } = await supabaseAdmin
      .from("companies")
      .select("name, website, product_category, industry")
      .eq("company_id", current.company_id)
      .maybeSingle();
    if (companyRow?.name && !String(companyRow.website ?? "").trim()) {
      try {
        await resolveCompanyWebsiteForTargetList(
          supabaseAdmin,
          current.company_id,
          {
            companyName: String(companyRow.name),
            productCategory: companyRow.product_category ?? null,
            industry: companyRow.industry ?? null,
          },
          { userId: profile.user_id }
        );
      } catch {
        // Non-fatal: athlete link still succeeds.
      }
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
