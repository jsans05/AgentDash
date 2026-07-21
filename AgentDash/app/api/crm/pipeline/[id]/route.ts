import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
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
  primaryPipelineContactEmail,
  quarantineEmail,
} from "@/lib/crm/email-quarantine";
import {
  buildCadenceTouchUpdates,
  buildCadenceUpdatesForStageChange,
} from "@/lib/crm/pipeline-cadence-server";
import { initCadenceOnSend, resetCadenceOnReengage } from "@/lib/crm/pipeline-cadence";
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
  "follow_up_step",
  "last_touch_at",
  "next_follow_up_at",
  "next_action",
  "follow_up_log",
  "timezone",
  "sequence_id",
  "sequence_started_at",
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
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
    } else if (key === "timezone") {
      const v = body.timezone;
      updates.timezone = v == null || String(v).trim() === "" ? null : String(v).trim();
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

  const cadenceAction = Object.prototype.hasOwnProperty.call(body, "cadence_action")
    ? String((body as { cadence_action?: unknown }).cadence_action ?? "").trim()
    : "";

  if (cadenceAction === "mark_touch") {
    const touchUpdates = buildCadenceTouchUpdates(
      {
        pipeline_stage: normalizePipelineStage(current.pipeline_stage),
        outreach_at: current.outreach_at != null ? String(current.outreach_at) : null,
        responded_at: current.responded_at != null ? String(current.responded_at) : null,
        follow_up_step: Number(current.follow_up_step ?? 0),
        last_touch_at: current.last_touch_at != null ? String(current.last_touch_at) : null,
        next_follow_up_at: current.next_follow_up_at != null ? String(current.next_follow_up_at) : null,
        next_action: current.next_action as "email" | "linkedin" | "call" | "cool" | null,
        follow_up_log: Array.isArray(current.follow_up_log) ? current.follow_up_log : [],
      },
      body as Record<string, unknown>
    );
    if (!touchUpdates) {
      return NextResponse.json({ error: "Invalid cadence touch" }, { status: 400 });
    }
    Object.assign(updates, touchUpdates);
  }

  if (cadenceAction === "mark_responded") {
    updates.pipeline_stage = "in_progress";
    updates.funnel_stage = pipelineStageToFunnel("in_progress");
    updates.responded_at = new Date().toISOString();
    updates.next_action = null;
    updates.next_follow_up_at = null;
    updates.follow_up_step = 0;
  }

  if (updates.pipeline_stage !== undefined) {
    const stage = String(updates.pipeline_stage);
    if (!PIPELINE_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid pipeline_stage" }, { status: 400 });
    }
    const normalizedStage = normalizePipelineStage(stage);
    updates.pipeline_stage = normalizedStage;
    updates.funnel_stage = pipelineStageToFunnel(normalizedStage);
    Object.assign(
      updates,
      buildCadenceUpdatesForStageChange(
        {
          pipeline_stage: normalizePipelineStage(current.pipeline_stage),
          outreach_at: current.outreach_at != null ? String(current.outreach_at) : null,
          responded_at: current.responded_at != null ? String(current.responded_at) : null,
          follow_up_step: Number(current.follow_up_step ?? 0),
          last_touch_at: current.last_touch_at != null ? String(current.last_touch_at) : null,
          next_follow_up_at: current.next_follow_up_at != null ? String(current.next_follow_up_at) : null,
          next_action: current.next_action as "email" | "linkedin" | "call" | "cool" | null,
          follow_up_log: Array.isArray(current.follow_up_log) ? current.follow_up_log : [],
        },
        normalizedStage,
        body as Record<string, unknown>
      )
    );
  }

  if (
    updates.pipeline_stage === "outreach" &&
    !current.outreach_at &&
    !Object.prototype.hasOwnProperty.call(body, "outreach_at") &&
    !Object.prototype.hasOwnProperty.call(updates, "outreach_at")
  ) {
    Object.assign(updates, initCadenceOnSend());
  }

  if (
    updates.pipeline_stage === "in_progress" &&
    !current.responded_at &&
    !Object.prototype.hasOwnProperty.call(body, "responded_at") &&
    !Object.prototype.hasOwnProperty.call(updates, "responded_at")
  ) {
    updates.responded_at = new Date().toISOString();
    updates.next_action = null;
    updates.next_follow_up_at = null;
    updates.follow_up_step = 0;
  }

  if (updates.pipeline_stage === "target" && normalizePipelineStage(current.pipeline_stage) === "ghost") {
    Object.assign(updates, resetCadenceOnReengage());
  }

  if (updates.pipeline_stage === "bounced" && normalizePipelineStage(current.pipeline_stage) !== "bounced") {
    const email =
      primaryPipelineContactEmail(
        Object.prototype.hasOwnProperty.call(updates, "pipeline_contacts")
          ? updates.pipeline_contacts
          : current.pipeline_contacts
      ) ?? primaryPipelineContactEmail(current.pipeline_contacts);
    if (email) {
      try {
        await quarantineEmail({
          supabaseAdmin,
          email,
          reason: "pipeline_bounced",
          userId: profile.user_id,
          companyId: current.company_id,
          pipelineId: current.id,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to quarantine email";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
  }

  if (
    Object.keys(updates).length === 0 &&
    Object.keys(companyPatch).length === 0 &&
    !markDraftSentAt &&
    !cadenceAction
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
  const profile = await requireNonAccounting();
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
