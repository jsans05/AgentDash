import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import {
  normalizePipelineStage,
  pipelineStageToFunnel,
  resolvePipelineStageFromBody,
} from "@/lib/crm/stage-map";
import { NextResponse } from "next/server";

const PIPELINE_UPDATE_SELECT =
  "id, company_id, created_by_user_id, status, support_email, contact_emails, relevant_people, notes, pipeline_stage, funnel_stage, priority, next_follow_up_at, archived, sent_at, created_at, updated_at" as const;

function normalizeEmails(emails: unknown): string[] {
  if (!Array.isArray(emails)) return [];
  const set = new Set<string>();
  for (const raw of emails) {
    const email = String(raw ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    set.add(email);
  }
  return [...set];
}

function normalizePriority(value: unknown, fallback: number): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  if (fallback === 1 || fallback === 2 || fallback === 3) return fallback;
  return 2;
}

function normalizeDate(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function guessNameFromEmail(email: string): { first_name: string; last_name: string } {
  const local = email.split("@")[0] ?? "";
  const parts = local
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first_name: "Contact", last_name: "Unknown" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "Contact" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const body = await req.json().catch(() => ({}));
  const { id } = await params;

  const { data: existing, error: fetchError } = await supabase
    .from("crm_companies_pipeline")
    .select("id, company_id, created_by_user_id, status, support_email, contact_emails, relevant_people, notes, pipeline_stage, funnel_stage, priority, next_follow_up_at, archived, companies(name)")
    .eq("id", id)
    .single();
  if (fetchError) return internalServerError(fetchError, "crm-company-pipeline:patch:load");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const action = String(body.action ?? "").trim();
  if (action === "promote_to_crm") {
    const allEmails = normalizeEmails([
      ...(existing.contact_emails ?? []),
      existing.support_email ?? "",
    ]);

    for (const email of allEmails) {
      const { data: dup } = await supabaseAdmin
        .from("crm_contacts")
        .select("contact_id")
        .eq("company_id", existing.company_id)
        .eq("email", email)
        .eq("created_by_user_id", existing.created_by_user_id)
        .maybeSingle();
      if (dup?.contact_id) continue;

      const name = guessNameFromEmail(email);
      const { error: insertError } = await supabaseAdmin.from("crm_contacts").insert({
        company_id: existing.company_id,
        created_by_user_id: existing.created_by_user_id,
        first_name: name.first_name,
        last_name: name.last_name,
        role: null,
        email,
        notes: `Imported from AI company pipeline${existing.status === "in_progress" ? "" : " (updated)"}`,
      });
      if (insertError) return internalServerError(insertError, "crm-company-pipeline:patch:promote-email");
    }

    const relevantPeople = Array.isArray(existing.relevant_people) ? existing.relevant_people : [];
    for (const person of relevantPeople) {
      const email = person?.email ? String(person.email).trim().toLowerCase() : null;
      const linkedin_url = person?.linkedin_url ? String(person.linkedin_url).trim() : null;
      const name = person?.name ? String(person.name).trim() : "";
      const first_name = name.split(/\s+/)[0] || "Contact";
      const last_name = name.split(/\s+/).slice(1).join(" ") || "Unknown";

      let dupQuery = supabaseAdmin
        .from("crm_contacts")
        .select("contact_id")
        .eq("company_id", existing.company_id)
        .eq("created_by_user_id", existing.created_by_user_id)
        .limit(1);
      if (email) dupQuery = dupQuery.eq("email", email);
      else if (linkedin_url) dupQuery = dupQuery.eq("linkedin_url", linkedin_url);
      else continue;

      const { data: dupRows } = await dupQuery;
      if ((dupRows ?? []).length > 0) continue;

      const { error: insertError } = await supabaseAdmin.from("crm_contacts").insert({
        company_id: existing.company_id,
        created_by_user_id: existing.created_by_user_id,
        first_name,
        last_name,
        role: null,
        email,
        linkedin_url,
        outreach_mode: email ? "email" : "linkedin",
        notes: `Imported from AI company pipeline${existing.status === "in_progress" ? "" : " (updated)"}`,
      });
      if (insertError) return internalServerError(insertError, "crm-company-pipeline:patch:promote-person");
    }

    const { data: updated, error: updateError } = await supabase
      .from("crm_companies_pipeline")
      .update({ status: "promoted_to_crm", sent_at: new Date().toISOString() })
      .eq("id", id)
      .select(PIPELINE_UPDATE_SELECT)
      .single();
    if (updateError) return internalServerError(updateError, "crm-company-pipeline:patch:promote-update");
    return NextResponse.json({ company: updated });
  }

  const contact_emails = body.contact_emails != null ? normalizeEmails(body.contact_emails) : existing.contact_emails;
  const relevant_people = Array.isArray(body.relevant_people) ? body.relevant_people : existing.relevant_people;
  const support_email =
    body.support_email != null ? String(body.support_email).trim().toLowerCase() || null : existing.support_email;
  const notes = body.notes != null ? String(body.notes) : existing.notes;
  const status = body.status != null ? String(body.status) : existing.status;
  const existingPipelineStage = normalizePipelineStage(
    (existing as { pipeline_stage?: string }).pipeline_stage ?? existing.funnel_stage,
    "target"
  );
  const resolvedStage = resolvePipelineStageFromBody(body);
  const pipeline_stage = resolvedStage ?? existingPipelineStage;
  const funnel_stage = pipelineStageToFunnel(pipeline_stage);
  const priority = normalizePriority(body.priority, Number(existing.priority ?? 2));
  const next_follow_up_at = normalizeDate(body.next_follow_up_at, existing.next_follow_up_at ?? null);
  const archived = body.archived != null ? body.archived === true : (existing.archived ?? false);
  const sent_at = body.mark_sent ? new Date().toISOString() : body.sent_at ?? null;
  const category = body.category != null ? String(body.category).trim() || null : undefined;
  const website = body.website != null ? String(body.website).trim() || null : undefined;
  const instagram_url = body.instagram_url != null ? String(body.instagram_url).trim() || null : undefined;

  const companyUpdate: any = {};
  if (category !== undefined) companyUpdate.industry = category;
  if (website !== undefined) companyUpdate.website = website;
  if (instagram_url !== undefined) companyUpdate.instagram_url = instagram_url;
  if (body.support_email !== undefined) companyUpdate.support_email = support_email;
  if (Object.keys(companyUpdate).length > 0) {
    await supabase.from("companies").update(companyUpdate).eq("company_id", existing.company_id);
  }

  const { data: updated, error: updateError } = await supabase
    .from("crm_companies_pipeline")
    .update({ contact_emails, relevant_people, support_email, notes, status, pipeline_stage, funnel_stage, priority, next_follow_up_at, archived, sent_at })
    .eq("id", id)
    .select(PIPELINE_UPDATE_SELECT)
    .single();
  if (updateError) return internalServerError(updateError, "crm-company-pipeline:patch:update");
  return NextResponse.json({ company: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireNonAccounting();
  const supabase = await createServerClient();
  const { id } = await params;

  const { error } = await supabase.from("crm_companies_pipeline").delete().eq("id", id);
  if (error) return internalServerError(error, "crm-company-pipeline:delete");
  return NextResponse.json({ ok: true });
}
