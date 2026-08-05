import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { quarantineEmail } from "@/lib/crm/email-quarantine";
import { assertNotBlockedCompanyName } from "@/lib/import/blocked-company-names";
import { NextResponse } from "next/server";

function normalizeEmail(v: unknown): string | null {
  const email = String(v ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

function normalizeEmailList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const set = new Set<string>();
  for (const v of list) {
    const email = normalizeEmail(v);
    if (email) set.add(email);
  }
  return [...set];
}

function sanitizeEmailDrafts(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  const out: unknown[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const body = o.body != null ? String(o.body) : "";
    if (!body.trim()) continue;
    const created_at =
      o.created_at != null && String(o.created_at).trim()
        ? String(o.created_at)
        : new Date().toISOString();
    const entry: Record<string, unknown> = {
      body,
      created_at,
    };
    if (o.label != null && String(o.label).trim()) entry.label = String(o.label).trim();
    if (o.subject != null && String(o.subject).trim()) entry.subject = String(o.subject).trim();
    if (o.athlete_id != null && String(o.athlete_id).trim()) entry.athlete_id = String(o.athlete_id).trim();
    out.push(entry);
    if (out.length >= 100) break;
  }
  return out;
}

function normalizeRelevantPeople(input: unknown): any[] {
  if (!Array.isArray(input)) return [];
  const out: any[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as any;
    const name = item.name != null ? String(item.name).trim() : null;
    const linkedin_url = item.linkedin_url != null ? String(item.linkedin_url).trim() : null;
    const email = normalizeEmail(item.email);
    if (!name && !linkedin_url && !email) continue;
    out.push({ name, linkedin_url, email, source_contact_id: item.source_contact_id ?? null });
  }
  return out;
}

async function getOrCreateCompanyByName(
  supabaseAdmin: Awaited<ReturnType<typeof createServiceRoleClient>>,
  companyName: string
): Promise<string> {
  const name = companyName.trim();
  assertNotBlockedCompanyName(name);
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  await requireNonAccounting();
  const supabase = await createServerClient();
  const { contact_id } = await params;

  // Fetching via RLS: if unauthorized, this should return no rows.
  const { data, error } = await supabase
    .from("crm_contacts")
    .select(
      `
        *,
        companies(name),
        sponsorship_taxonomies:taxonomy_id (sport, tier, category)
      `
    )
    .eq("contact_id", contact_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ contact: data });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();

  const { contact_id } = await params;
  const body = await req.json().catch(() => ({}));

  const { data: existing, error: existingError } = await supabase
    .from("crm_contacts")
    .select("*")
    .eq("contact_id", contact_id)
    .single();

  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const action = body.action != null ? String(body.action) : null;
  if (action) {
    if (action === "touch_last_outreach") {
      const { data: updated, error: updateError } = await supabase
        .from("crm_contacts")
        .update({ last_outreach_at: new Date().toISOString() })
        .eq("contact_id", contact_id)
        .select("*")
        .single();
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      return NextResponse.json({ contact: updated });
    }

    if (action === "set_status_tag") {
      const status_tag = String(body.status_tag ?? "none");
      const allowed = new Set(["none", "green_conversation", "yellow_authenticated", "red_bounced"]);
      if (!allowed.has(status_tag)) {
        return NextResponse.json({ error: "invalid status_tag" }, { status: 400 });
      }
      const archived = status_tag === "red_bounced" ? true : existing.archived;
      const { data: updated, error: updateError } = await supabase
        .from("crm_contacts")
        .update({ status_tag, archived })
        .eq("contact_id", contact_id)
        .select("*")
        .single();
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      if (status_tag === "red_bounced" && existing.email) {
        try {
          await quarantineEmail({
            supabaseAdmin,
            email: String(existing.email),
            reason: "contact_red_bounced",
            userId: String(existing.created_by_user_id),
            companyId: existing.company_id ?? null,
            contactId: contact_id,
          });
        } catch {
          // Non-fatal
        }
      }
      return NextResponse.json({ contact: updated });
    }

    if (action === "archive_red") {
      const { data: updated, error: updateError } = await supabase
        .from("crm_contacts")
        .update({ archived: true, status_tag: "red_bounced" })
        .eq("contact_id", contact_id)
        .select("*")
        .single();
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      if (existing.email) {
        try {
          await quarantineEmail({
            supabaseAdmin,
            email: String(existing.email),
            reason: "contact_red_bounced",
            userId: String(existing.created_by_user_id),
            companyId: existing.company_id ?? null,
            contactId: contact_id,
          });
        } catch {
          // Non-fatal
        }
      }
      return NextResponse.json({ contact: updated });
    }

    if (action === "push_to_pipeline_person" || action === "push_to_pipeline_support") {
      const contactEmail = normalizeEmail(existing.email);

      const { data: pipelineExisting, error: pipelineError } = await supabase
        .from("crm_companies_pipeline")
        .select("id, contact_emails, support_email, relevant_people")
        .eq("company_id", existing.company_id)
        .eq("created_by_user_id", existing.created_by_user_id)
        .maybeSingle();
      if (pipelineError) return NextResponse.json({ error: pipelineError.message }, { status: 500 });

      const personName = `${existing.first_name ?? ""} ${existing.last_name ?? ""}`.trim() || null;
      const personLinkedin = existing.linkedin_url ? String(existing.linkedin_url).trim() : null;
      const personEntry = {
        name: personName,
        linkedin_url: personLinkedin,
        email: contactEmail,
        source_contact_id: existing.contact_id,
      };

      if (pipelineExisting) {
        const mergedEmails = normalizeEmailList([...(pipelineExisting.contact_emails ?? []), contactEmail ?? ""]);
        const mergedPeople = normalizeRelevantPeople([...(pipelineExisting.relevant_people ?? []), personEntry]);
        const updatePayload: any = {
          status: "in_progress",
          contact_emails: mergedEmails,
          relevant_people: mergedPeople,
          notes: existing.notes ?? null,
        };
        if (action === "push_to_pipeline_support" && contactEmail) {
          updatePayload.support_email = contactEmail;
        }
        const { error: updateError } = await supabase
          .from("crm_companies_pipeline")
          .update(updatePayload)
          .eq("id", pipelineExisting.id);
        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      } else {
        const insertPayload: any = {
          company_id: existing.company_id,
          created_by_user_id: existing.created_by_user_id,
          status: "in_progress",
          contact_emails: contactEmail ? [contactEmail] : [],
          relevant_people: normalizeRelevantPeople([personEntry]),
          notes: existing.notes ?? null,
        };
        if (action === "push_to_pipeline_support" && contactEmail) {
          insertPayload.support_email = contactEmail;
        }
        const { error: insertError } = await supabase.from("crm_companies_pipeline").insert(insertPayload);
        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }
  }

  // Only allow agent-owned updates via RLS policy; this is just to decide fallbacks.
  // (Actual authorization is enforced by the RLS update policy.)
  const first_name = body.first_name != null ? String(body.first_name).trim() : existing.first_name;
  const last_name = body.last_name != null ? String(body.last_name).trim() : existing.last_name;

  const company_name = body.company_name != null ? String(body.company_name).trim() : null;
  const role = body.role != null ? String(body.role) : null;
  const email = body.email != null ? String(body.email) : null;
  const phone = body.phone != null ? String(body.phone) : existing.phone;
  const linkedin_url = body.linkedin_url != null ? String(body.linkedin_url) : null;
  const zoominfo_url = body.zoominfo_url != null ? String(body.zoominfo_url) : null;

  const taxonomy_id = body.taxonomy_id != null ? String(body.taxonomy_id) : existing.taxonomy_id;
  const product_description = body.product_description != null ? String(body.product_description) : existing.product_description;
  const notes = body.notes != null ? String(body.notes) : existing.notes;
  const outreach_mode = body.outreach_mode != null ? String(body.outreach_mode) : existing.outreach_mode;
  if (!["email", "linkedin", "other"].includes(outreach_mode)) {
    return NextResponse.json({ error: "invalid outreach_mode" }, { status: 400 });
  }

  const timezone =
    Object.prototype.hasOwnProperty.call(body, "timezone")
      ? body.timezone == null || String(body.timezone).trim() === ""
        ? null
        : String(body.timezone).trim()
      : existing.timezone ?? null;

  let status_tag = existing.status_tag;
  if (body.status_tag != null) {
    const nextStatus = String(body.status_tag);
    const allowed = new Set(["none", "green_conversation", "yellow_authenticated", "red_bounced"]);
    if (!allowed.has(nextStatus)) {
      return NextResponse.json({ error: "invalid status_tag" }, { status: 400 });
    }
    status_tag = nextStatus as typeof status_tag;
  }

  let archived = existing.archived;
  if (body.archived !== undefined) {
    archived = Boolean(body.archived);
  }
  if (status_tag === "red_bounced") {
    archived = true;
  }

  if (!first_name || !last_name) {
    return NextResponse.json({ error: "first_name and last_name required" }, { status: 400 });
  }

  let company_id = existing.company_id;
  if (company_name) {
    company_id = await getOrCreateCompanyByName(supabaseAdmin, company_name);
  }

  let category: string | null = existing.category;
  if (taxonomy_id) {
    const { data: taxonomyRow, error: taxonomyError } = await supabaseAdmin
      .from("sponsorship_taxonomies")
      .select("category")
      .eq("id", taxonomy_id)
      .maybeSingle();

    if (taxonomyError) return NextResponse.json({ error: taxonomyError.message }, { status: 500 });
    category = taxonomyRow?.category ?? null;
  } else {
    category = null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("crm_contacts")
    .update({
      company_id,
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
      timezone,
      status_tag,
      archived,
      ...(body.email_drafts !== undefined ? { email_drafts: sanitizeEmailDrafts(body.email_drafts) } : {}),
    })
    .eq("contact_id", contact_id)
    .select("*")
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ contact: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  await requireNonAccounting();
  const supabase = await createServerClient();
  const { contact_id } = await params;

  const { error } = await supabase.from("crm_contacts").delete().eq("contact_id", contact_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

