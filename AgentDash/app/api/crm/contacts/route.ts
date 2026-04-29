import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

function escapeForIlike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

  if (existingError) {
    throw new Error(existingError.message);
  }
  if (existing) return existing.company_id;

  const { data: created, error: createdError } = await supabaseAdmin
    .from("companies")
    .insert({ name, industry: null })
    .select("company_id")
    .single();

  if (createdError) {
    throw new Error(createdError.message);
  }
  return created!.company_id;
}

export async function GET(req: Request) {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const taxonomyId = url.searchParams.get("taxonomy_id")?.trim() || null;
  const showInProgress = url.searchParams.get("show_in_progress") === "1";

  let query = supabase
    .from("crm_contacts")
    .select(
      `
        *,
        companies(name),
        sponsorship_taxonomies:taxonomy_id (sport, tier, category)
      `
    )
    .order("last_outreach_at", { ascending: false })
    .order("created_at", { ascending: false });

  // RLS should handle this, but we keep agent scoping explicit for performance/readability.
  if (profile.role === "agent") {
    query = query.eq("created_by_user_id", profile.user_id);
  }

  if (taxonomyId) {
    query = query.eq("taxonomy_id", taxonomyId);
  }

  if (!showInProgress) {
    let pipelineQuery = supabase
      .from("crm_companies_pipeline")
      .select("company_id")
      .eq("status", "in_progress");
    if (profile.role === "agent") {
      pipelineQuery = pipelineQuery.eq("created_by_user_id", profile.user_id);
    }
    const { data: inProgressRows } = await pipelineQuery;
    const inProgressCompanyIds = (inProgressRows ?? []).map((r: any) => r.company_id).filter(Boolean);
    if (inProgressCompanyIds.length > 0) {
      const inList = `(${inProgressCompanyIds.map((id: string) => `"${id}"`).join(",")})`;
      query = query.not("company_id", "in", inList);
    }
  }

  if (q) {
    const escaped = escapeForIlike(q);
    const pattern = `%${escaped}%`;

    // Match on person fields first.
    const { data: personMatches } = await supabase
      .from("crm_contacts")
      .select("contact_id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`);

    const personIds = (personMatches ?? []).map((r: any) => r.contact_id);

    // Match on company name (resolve to company_ids, then contacts).
    const { data: companyMatches } = await supabase.from("companies").select("company_id").ilike("name", pattern);
    const companyIds = (companyMatches ?? []).map((r: any) => r.company_id);

    let ids = new Set<string>();
    for (const id of personIds) ids.add(id);
    if (companyIds.length > 0) {
      const { data: companyContactMatches } = await supabase
        .from("crm_contacts")
        .select("contact_id")
        .in("company_id", companyIds);
      for (const r of companyContactMatches ?? []) ids.add(r.contact_id);
    }

    const idList = [...ids];
    if (idList.length === 0) {
      return NextResponse.json({ contacts: [] });
    }
    query = query.in("contact_id", idList);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contacts: data ?? [] });
}

export async function POST(req: Request) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();

  const body = await req.json().catch(() => ({}));

  const first_name = String(body.first_name ?? "").trim();
  const last_name = String(body.last_name ?? "").trim();
  const company_name = String(body.company_name ?? "").trim();
  const role = body.role != null ? String(body.role) : null;
  const email = body.email != null ? String(body.email) : null;
  const phone = body.phone != null ? String(body.phone) : null;
  const linkedin_url = body.linkedin_url != null ? String(body.linkedin_url) : null;
  const zoominfo_url = body.zoominfo_url != null ? String(body.zoominfo_url) : null;

  const taxonomy_id = body.taxonomy_id ? String(body.taxonomy_id) : null;
  const product_description = body.product_description != null ? String(body.product_description) : null;
  const notes = body.notes != null ? String(body.notes) : null;
  const outreach_mode = body.outreach_mode != null ? String(body.outreach_mode) : "email";
  if (!["email", "linkedin", "other"].includes(outreach_mode)) {
    return NextResponse.json({ error: "invalid outreach_mode" }, { status: 400 });
  }

  if (!first_name || !last_name) {
    return NextResponse.json({ error: "first_name and last_name required" }, { status: 400 });
  }
  if (!company_name) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const company_id = await getOrCreateCompanyByName(supabaseAdmin, company_name);

  let category: string | null = null;
  if (taxonomy_id) {
    const { data: taxonomyRow, error: taxonomyError } = await supabaseAdmin
      .from("sponsorship_taxonomies")
      .select("category")
      .eq("id", taxonomy_id)
      .maybeSingle();
    if (taxonomyError) return NextResponse.json({ error: taxonomyError.message }, { status: 500 });
    category = taxonomyRow?.category ?? null;
  }

  const insertPayload = {
    company_id,
    created_by_user_id: profile.user_id,
    first_name,
    last_name,
    role,
    email,
    phone,
    linkedin_url,
    zoominfo_url,
    taxonomy_id,
    category,
    product_description,
    notes,
    outreach_mode,
  };

  const { data, error } = await supabase.from("crm_contacts").insert(insertPayload).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contact: data });
}

