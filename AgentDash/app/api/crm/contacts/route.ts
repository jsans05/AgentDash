import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { enforceContentLengthLimit } from "@/lib/api/request-limits";
import { NextResponse } from "next/server";
import { ilikeContains } from "@/lib/supabase/ilike";

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasText(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
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
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const excludedCompanyIds = new Set<string>();

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
    const inProgressCompanyIds = (inProgressRows ?? [])
      .map((r: any) => String(r?.company_id ?? "").trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    for (const id of inProgressCompanyIds) {
      excludedCompanyIds.add(id);
    }
  }

  if (q) {
    const pattern = ilikeContains(q);

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
  if (error) return internalServerError(error, "crm-contacts:get");

  const contacts = excludedCompanyIds.size
    ? (data ?? []).filter((row: any) => !excludedCompanyIds.has(String(row?.company_id ?? "")))
    : (data ?? []);
  return NextResponse.json({ contacts });
}

export async function POST(req: Request) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();

  const body = await req.json().catch(() => ({}));

  const first_name = String(body.first_name ?? "").trim();
  const last_name = String(body.last_name ?? "").trim();
  const company_name = String(body.company_name ?? "").trim();
  const consulting_profile_id =
    body.consulting_profile_id != null ? String(body.consulting_profile_id).trim() || null : null;
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
    if (taxonomyError) return internalServerError(taxonomyError, "crm-contacts:post:taxonomy");
    category = taxonomyRow?.category ?? null;
  }

  const insertPayload = {
    company_id,
    created_by_user_id: profile.user_id,
    consulting_profile_id,
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

  const normalizedFirst = normalizeText(first_name);
  const normalizedLast = normalizeText(last_name);
  const normalizedEmail = normalizeText(email);

  let existingQuery = supabase
    .from("crm_contacts")
    .select(
      "contact_id, first_name, last_name, role, email, phone, linkedin_url, zoominfo_url, taxonomy_id, category, product_description, notes, outreach_mode"
    )
    .eq("company_id", company_id)
    .eq("archived", false);
  if (consulting_profile_id) {
    existingQuery = existingQuery.eq("consulting_profile_id", consulting_profile_id);
  } else {
    existingQuery = existingQuery.eq("created_by_user_id", profile.user_id);
  }
  const { data: existingRows, error: existingError } = await existingQuery.limit(200);
  if (existingError) return internalServerError(existingError, "crm-contacts:post:existing-lookup");

  const duplicate = (existingRows ?? []).find((row: any) => {
    const emailMatch =
      !!normalizedEmail &&
      !!normalizeText(row?.email) &&
      normalizeText(row?.email) === normalizedEmail;
    const nameMatch =
      normalizeText(row?.first_name) === normalizedFirst &&
      normalizeText(row?.last_name) === normalizedLast;
    return emailMatch || nameMatch;
  });

  if (duplicate) {
    const dedupePatch: Record<string, unknown> = {};
    if (hasText(role) && !hasText(duplicate.role)) dedupePatch.role = role;
    if (hasText(email) && !hasText(duplicate.email)) dedupePatch.email = email;
    if (hasText(phone) && !hasText(duplicate.phone)) dedupePatch.phone = phone;
    if (hasText(linkedin_url) && !hasText(duplicate.linkedin_url)) dedupePatch.linkedin_url = linkedin_url;
    if (hasText(zoominfo_url) && !hasText(duplicate.zoominfo_url)) dedupePatch.zoominfo_url = zoominfo_url;
    if (taxonomy_id && !duplicate.taxonomy_id) dedupePatch.taxonomy_id = taxonomy_id;
    if (category && !hasText(duplicate.category)) dedupePatch.category = category;
    if (hasText(product_description) && !hasText(duplicate.product_description)) {
      dedupePatch.product_description = product_description;
    }
    if (hasText(notes) && !hasText(duplicate.notes)) dedupePatch.notes = notes;
    if (outreach_mode && !hasText(duplicate.outreach_mode)) dedupePatch.outreach_mode = outreach_mode;

    if (Object.keys(dedupePatch).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from("crm_contacts")
        .update(dedupePatch)
        .eq("contact_id", duplicate.contact_id)
        .select("*")
        .single();
      if (updateError) return internalServerError(updateError, "crm-contacts:post:dedupe-update");
      return NextResponse.json({ contact: updated, deduped: true });
    }

    return NextResponse.json({ contact: duplicate, deduped: true });
  }

  const { data, error } = await supabase.from("crm_contacts").insert(insertPayload).select("*").single();
  if (error) return internalServerError(error, "crm-contacts:post:insert");

  return NextResponse.json({ contact: data });
}

