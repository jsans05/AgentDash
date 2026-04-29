import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  fetchPipelineCardById,
  fetchPipelineCardsForUser,
  PIPELINE_CARD_SELECT,
} from "@/lib/features/crm-pipeline/service";
import { NextResponse } from "next/server";

async function getOrCreateCompanyByNameCaseInsensitive(
  supabaseAdmin: Awaited<ReturnType<typeof createServiceRoleClient>>,
  companyName: string
): Promise<{ company_id: string; name: string }> {
  const trimmed = companyName.trim();
  if (!trimmed) throw new Error("company_name required");

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("companies")
    .select("company_id, name")
    .ilike("name", trimmed)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.company_id) return { company_id: existing.company_id, name: existing.name ?? trimmed };

  const { data: created, error: createdError } = await supabaseAdmin
    .from("companies")
    .insert({ name: trimmed, industry: null })
    .select("company_id, name")
    .single();

  if (createdError) throw new Error(createdError.message);
  return { company_id: created.company_id, name: created.name ?? trimmed };
}

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  try {
    const cards = await fetchPipelineCardsForUser(supabase, profile.user_id);
    return NextResponse.json({ cards });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load pipeline cards";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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

  let company_id: string;
  let resolvedName: string;
  try {
    const c = await getOrCreateCompanyByNameCaseInsensitive(supabaseAdmin, company_name);
    company_id = c.company_id;
    resolvedName = c.name;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to resolve company";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: existing } = await supabase
    .from("crm_companies_pipeline")
    .select("id, archived")
    .eq("company_id", company_id)
    .eq("created_by_user_id", profile.user_id)
    .maybeSingle();

  if (existing?.id) {
    if (existing.archived === true) {
      const { data: updated, error: upErr } = await supabase
        .from("crm_companies_pipeline")
        .update({ archived: false, pipeline_stage: "target" })
        .eq("id", existing.id)
        .select(PIPELINE_CARD_SELECT)
        .single();
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
      const card = await fetchPipelineCardById(supabase, updated.id);
      return NextResponse.json({ card });
    }
    const cardExisting = await fetchPipelineCardById(supabase, existing.id);
    return NextResponse.json({ card: cardExisting });
  }

  const { data: created, error: createError } = await supabase
    .from("crm_companies_pipeline")
    .insert({
      company_id,
      created_by_user_id: profile.user_id,
      pipeline_stage: "target",
    })
    .select(PIPELINE_CARD_SELECT)
    .single();

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  const cardNew = await fetchPipelineCardById(supabase, created.id);
  return NextResponse.json({ card: cardNew });
}
