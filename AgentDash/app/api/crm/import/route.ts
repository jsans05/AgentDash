import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { enforceContentLengthLimit, enforceFileSizeLimit, MAX_API_PAYLOAD_BYTES } from "@/lib/api/request-limits";
import { NextResponse } from "next/server";
import readXlsxFile from "read-excel-file/node";

function rowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  return (rows.slice(1) as unknown[][]).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim();
}

function parseEmailAndLinkedin(value: unknown): { email: string | null; linkedin_url: string | null } {
  const s = value == null ? "" : String(value).trim();
  if (!s) return { email: null, linkedin_url: null };

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const emailMatch = s.match(emailRegex);
  const email = emailMatch ? emailMatch[0] : null;

  // Prefer explicit linkedin URLs; also accept linkedin.com/in/... without scheme.
  const linkedinRegex = /(https?:\/\/[^\s,;]+linkedin\.com\/[^\s,;]+)|(linkedin\.com\/[^\s,;]+)/i;
  const linkedinMatch = s.match(linkedinRegex);
  let linkedin_url: string | null = null;
  if (linkedinMatch) {
    const raw = linkedinMatch[0];
    linkedin_url = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  }

  return { email, linkedin_url };
}

function parseDateToIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  if (!s) return null;

  // Handle excel serial dates if we get a number as string.
  const n = Number(s);
  if (!Number.isNaN(n) && Number.isFinite(n) && n > 0) {
    // Excel serial date: days since 1899-12-30
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = epoch.getTime() + n * 24 * 60 * 60 * 1000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

async function resolveTaxonomyIdByCategory(
  supabaseAdmin: Awaited<ReturnType<typeof createServiceRoleClient>>,
  category: string
): Promise<{ taxonomy_id: string | null; normalizedCategory: string }> {
  const normalizedCategory = category.trim();
  if (!normalizedCategory) return { taxonomy_id: null, normalizedCategory };

  // Best-effort: category values are expected to match taxonomy.category.
  const { data, error } = await supabaseAdmin
    .from("sponsorship_taxonomies")
    .select("id")
    .eq("is_active", true)
    .ilike("category", normalizedCategory)
    .order("sort_order", { ascending: true })
    .limit(1);

  if (error) return { taxonomy_id: null, normalizedCategory };
  return { taxonomy_id: data?.[0]?.id ?? null, normalizedCategory };
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
  if (existing) return existing.company_id;

  const { data: created, error: createdError } = await supabaseAdmin
    .from("companies")
    .insert({ name, industry: null })
    .select("company_id")
    .single();

  if (createdError) throw new Error(createdError.message);
  return created!.company_id;
}

export async function POST(req: Request) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireProfile();
  if (profile.role === "sales") {
    return NextResponse.json({ error: "Not allowed for sales role" }, { status: 403 });
  }

  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const fileSizeError = enforceFileSizeLimit(
    file,
    MAX_API_PAYLOAD_BYTES,
    "Uploaded file too large. Max 25 MB."
  );
  if (fileSizeError) return fileSizeError;

  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return NextResponse.json({ error: "Please upload an .xlsx/.xls file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = await readXlsxFile(buffer);
  const sheetRows = (workbook[0]?.data ?? []) as unknown[][];
  const objects = rowsToObjects(sheetRows);
  if (objects.length === 0) {
    return NextResponse.json({ error: "No rows found in spreadsheet" }, { status: 400 });
  }

  // Map column names (case-insensitive) to fields.
  const sampleRow = objects[0];
  const headers = Object.keys(sampleRow);
  const byHeader = new Map<string, string>();
  for (const h of headers) byHeader.set(normalizeHeader(h), h);

  function getCol(...keys: string[]): string | null {
    for (const k of keys) {
      const match = byHeader.get(normalizeHeader(k));
      if (match) return match;
    }
    return null;
  }

  const firstCol = getCol("First", "first");
  const lastCol = getCol("Last", "last");
  const emailLinkedinCol = getCol("Email/ Linkedin", "Email/Linkedin", "email/linkedin", "email", "linkedin");
  const companyCol = getCol("Company", "company");
  const roleCol = getCol("Role", "role");
  const categoryCol = getCol("Category", "category");
  const zoominfoCol = getCol("Zoominfo", "ZoomInfo", "zoominfo");
  const notesCol = getCol("Notes", "notes");
  const lastOutreachCol = getCol("Last Outreach", "Last Outreach", "last_outreach", "last outreach", "last_outreach_at", "lastoutreach");

  const missing = [
    { name: "First", col: firstCol },
    { name: "Last", col: lastCol },
    { name: "Email/LinkedIn", col: emailLinkedinCol },
    { name: "Company", col: companyCol },
  ].filter((x) => !x.col);

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required columns: ${missing.map((m) => m.name).join(", ")}`,
      },
      { status: 400 }
    );
  }

  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of objects) {
    processed++;

    const first_name = firstCol ? String(row[firstCol] ?? "").trim() : "";
    const last_name = lastCol ? String(row[lastCol] ?? "").trim() : "";
    const company_name = companyCol ? String(row[companyCol] ?? "").trim() : "";
    const role = roleCol ? String(row[roleCol] ?? "").trim() || null : null;
    const categoryRaw = categoryCol ? String(row[categoryCol] ?? "").trim() : "";
    const zoominfo_url = zoominfoCol ? String(row[zoominfoCol] ?? "").trim() || null : null;
    const notes = notesCol ? String(row[notesCol] ?? "").trim() || null : null;
    const last_outreach_at = lastOutreachCol ? parseDateToIso(row[lastOutreachCol]) : null;

    if (!first_name || !last_name || !company_name) {
      skipped++;
      continue;
    }

    const { email, linkedin_url } = parseEmailAndLinkedin(row[emailLinkedinCol!]);

    // Determine taxonomy lane (optional)
    let taxonomy_id: string | null = null;
    let category: string | null = categoryRaw ? categoryRaw : null;
    if (categoryRaw.trim()) {
      const resolved = await resolveTaxonomyIdByCategory(supabaseAdmin, categoryRaw);
      taxonomy_id = resolved.taxonomy_id;
      category = resolved.normalizedCategory;
    }

    const company_id = await getOrCreateCompanyByName(supabaseAdmin, company_name);

    // Upsert by email (preferred). If no email, always insert (no reliable match).
    let existingContactId: string | null = null;
    if (email) {
      const { data: existingRows } = await supabase
        .from("crm_contacts")
        .select("contact_id")
        .eq("created_by_user_id", profile.user_id)
        .ilike("email", email)
        .limit(1);
      existingContactId = existingRows?.[0]?.contact_id ?? null;
    }

    const payload = {
      company_id,
      created_by_user_id: profile.user_id,
      first_name,
      last_name,
      role,
      email: email ?? null,
      linkedin_url: linkedin_url ?? null,
      zoominfo_url,
      taxonomy_id,
      category,
      product_description: null,
      notes,
      last_outreach_at,
    };

    if (existingContactId) {
      const { data: updatedRow, error: updateError } = await supabase
        .from("crm_contacts")
        .update(payload as any)
        .eq("contact_id", existingContactId)
        .select("*")
        .single();

      if (updateError) {
        skipped++;
        continue;
      }
      if (updatedRow) updated++;
      continue;
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from("crm_contacts")
      .insert(payload as any)
      .select("*")
      .single();

    if (insertError) {
      skipped++;
      continue;
    }
    if (insertedRow) inserted++;
  }

  return NextResponse.json({
    processed,
    inserted,
    updated,
    skipped,
  });
}

