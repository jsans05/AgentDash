import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";
import { normalizePipelineStage, pipelineStageToFunnel, resolvePipelineStageFromBody } from "@/lib/crm/stage-map";
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

function normalizePriority(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return 2;
}

function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function getOrCreateCompanyByName(
  supabaseAdmin: Awaited<ReturnType<typeof createServiceRoleClient>>,
  companyName: string
): Promise<string> {
  const name = companyName.trim();
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("companies")
    .select("company_id")
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.company_id) return existing.company_id;

  const { data: created, error: createdError } = await supabaseAdmin
    .from("companies")
    .insert({ name, industry: null })
    .select("company_id")
    .single();
  if (createdError) throw new Error(createdError.message);
  return created.company_id;
}

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  let query = supabase
    .from("crm_companies_pipeline")
    .select("id, company_id, status, support_email, contact_emails, relevant_people, notes, pipeline_stage, funnel_stage, priority, next_follow_up_at, archived, sent_at, created_at, updated_at, companies(name, industry, website, instagram_url, support_email)")
    .order("updated_at", { ascending: false });

  if (profile.role === "agent") {
    query = query.eq("created_by_user_id", profile.user_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ companies: data ?? [] });
}

export async function POST(req: Request) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const body = await req.json().catch(() => ({}));

  const company_name = String(body.company_name ?? "").trim();
  if (!company_name) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const company_id = await getOrCreateCompanyByName(supabaseAdmin, company_name);
  const websiteFromBody = body.website != null ? String(body.website).trim() || null : null;
  try {
    await resolveCompanyWebsiteForTargetList(
      supabaseAdmin,
      company_id,
      {
        companyName: company_name,
        websiteHint: websiteFromBody,
      },
      { userId: profile.user_id }
    );
  } catch {
    // Non-fatal: pipeline card creation continues.
  }
  const support_email = body.support_email != null ? String(body.support_email).trim().toLowerCase() || null : null;
  const contact_emails = normalizeEmails(body.contact_emails);
  const relevant_people = Array.isArray(body.relevant_people) ? body.relevant_people : [];
  const notes = body.notes != null ? String(body.notes) : null;
  const pipeline_stage =
    resolvePipelineStageFromBody(body) ?? normalizePipelineStage(body.funnel_stage);
  const priority = normalizePriority(body.priority);
  const next_follow_up_at = normalizeDate(body.next_follow_up_at);
  const archived = body.archived === true;
  const category = body.category != null ? String(body.category).trim() || null : undefined;
  const website = body.website != null ? String(body.website).trim() || null : undefined;
  const instagram_url = body.instagram_url != null ? String(body.instagram_url).trim() || null : undefined;

  const { data: existing } = await supabase
    .from("crm_companies_pipeline")
    .select("id, contact_emails, relevant_people")
    .eq("company_id", company_id)
    .eq("created_by_user_id", profile.user_id)
    .maybeSingle();

  const companyUpdate: any = {};
  if (category !== undefined) companyUpdate.industry = category;
  if (website !== undefined) companyUpdate.website = website;
  if (instagram_url !== undefined) companyUpdate.instagram_url = instagram_url;
  if (body.support_email !== undefined) companyUpdate.support_email = support_email;
  if (Object.keys(companyUpdate).length > 0) {
    await supabase.from("companies").update(companyUpdate).eq("company_id", company_id);
  }
  if (isApolloEnabled() && website) {
    try {
      await persistApolloMetadataForCompany(supabaseAdmin, company_id, { website });
    } catch {
      // non-fatal
    }
  }

  if (existing) {
    const merged = normalizeEmails([...(existing.contact_emails ?? []), ...contact_emails]);
    const mergedPeople = [...(existing.relevant_people ?? []), ...relevant_people];
    const { data: updated, error: updateError } = await supabase
      .from("crm_companies_pipeline")
      .update({
        support_email,
        contact_emails: merged,
        relevant_people: mergedPeople,
        notes,
        status: "in_progress",
        pipeline_stage,
        funnel_stage: pipelineStageToFunnel(pipeline_stage),
        priority,
        next_follow_up_at,
        archived,
      })
      .eq("id", existing.id)
      .select(PIPELINE_UPDATE_SELECT)
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    return NextResponse.json({ company: updated, created: false });
  }

  const { data: created, error: createError } = await supabase
    .from("crm_companies_pipeline")
    .insert({
      company_id,
      created_by_user_id: profile.user_id,
      status: "in_progress",
      support_email,
      contact_emails,
      relevant_people,
      notes,
      pipeline_stage,
      funnel_stage: pipelineStageToFunnel(pipeline_stage),
      priority,
      next_follow_up_at,
      archived,
    })
    .select(PIPELINE_UPDATE_SELECT)
    .single();
  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
  return NextResponse.json({ company: created, created: true });
}
