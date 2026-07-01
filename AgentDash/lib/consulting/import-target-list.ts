import type { SupabaseClient } from "@supabase/supabase-js";
import readXlsxFile from "read-excel-file/node";
import { splitName } from "@/lib/import/name-match";
import { getOrCreateCompanyByName } from "@/lib/consulting/companies";
import {
  firmographicsPatchFromImportRow,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";
import { isApolloEnabled } from "@/lib/apollo/config";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";
import { apolloLastNameForStorage } from "@/lib/crm/contact-display-name";

export type ConsultingTargetListImportRow = {
  company_name: string;
  industry_category?: string | null;
  website?: string | null;
  match_score?: number | null;
  company_description?: string | null;
  personal_notes?: string | null;
  hq_phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  annual_revenue?: number | null;
  annual_revenue_printed?: string | null;
  total_funding?: number | null;
  total_funding_printed?: string | null;
  latest_funding_stage?: string | null;
  estimated_num_employees?: number | null;
  headcount_six_month_growth?: number | null;
  headcount_twelve_month_growth?: number | null;
  headcount_twenty_four_month_growth?: number | null;
};

export type ConsultingTargetListColumnMap = {
  companyCol: string;
  industryCategoryCol: string | null;
  websiteCol: string | null;
  matchScoreCol: string | null;
  companyDescriptionCol: string | null;
  personalNotesCol: string | null;
  hqPhoneCol: string | null;
  firstCol: string | null;
  lastCol: string | null;
  contactCol: string | null;
  titleCol: string | null;
  emailCol: string | null;
};

export type ConsultingTargetListParseResult = {
  rows: ConsultingTargetListImportRow[];
  errors: string[];
};

export type ConsultingTargetListUpsertSummary = {
  processed: number;
  companies_upserted: number;
  contacts_inserted: number;
  contacts_updated: number;
  skipped: number;
  row_errors: string[];
};

function rowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  return (rows.slice(1) as unknown[][]).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i];
    });
    return obj;
  });
}

export function normalizeImportHeader(h: string): string {
  return h.toLowerCase().trim();
}

export function parseEmailAndLinkedin(value: unknown): {
  email: string | null;
  linkedin_url: string | null;
} {
  const s = value == null ? "" : String(value).trim();
  if (!s) return { email: null, linkedin_url: null };

  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const emailMatch = s.match(emailRegex);
  const email = emailMatch ? emailMatch[0] : null;

  const linkedinRegex =
    /(https?:\/\/[^\s,;]+linkedin\.com\/[^\s,;]+)|(linkedin\.com\/[^\s,;]+)/i;
  const linkedinMatch = s.match(linkedinRegex);
  let linkedin_url: string | null = null;
  if (linkedinMatch) {
    const raw = linkedinMatch[0];
    linkedin_url =
      raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  }

  return { email, linkedin_url };
}

function cellString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseOptionalMatchScore(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildConsultingTargetListColumnMap(
  headers: string[]
): ConsultingTargetListColumnMap | { error: string } {
  const byHeader = new Map<string, string>();
  for (const h of headers) {
    const key = normalizeImportHeader(h);
    if (key && !byHeader.has(key)) byHeader.set(key, h);
  }

  function getCol(...keys: string[]): string | null {
    for (const k of keys) {
      const match = byHeader.get(normalizeImportHeader(k));
      if (match) return match;
    }
    return null;
  }

  const companyCol = getCol("Company", "Brand");
  if (!companyCol) {
    return { error: "Missing required column: Company or Brand" };
  }

  return {
    companyCol,
    industryCategoryCol: getCol("Industry Category", "Category"),
    websiteCol: getCol("Website", "Company Website"),
    matchScoreCol: getCol("Match Score"),
    companyDescriptionCol: getCol("Company Description", "Description"),
    personalNotesCol: getCol("Personal Notes", "Notes"),
    hqPhoneCol: getCol("HQ Phone", "HQ Number", "Company Phone", "Number"),
    firstCol: getCol("First"),
    lastCol: getCol("Last"),
    contactCol: getCol("Contact", "Contact Name"),
    titleCol: getCol("Title", "Role"),
    emailCol: getCol("Email", "Email/ Linkedin", "Email/Linkedin", "email/linkedin"),
  };
}

export function resolveContactNamesForImport(
  row: Record<string, unknown>,
  cols: Pick<ConsultingTargetListColumnMap, "firstCol" | "lastCol" | "contactCol">
): { first_name: string | null; last_name: string | null; hasContactIntent: boolean } {
  const firstRaw = cols.firstCol ? cellString(row[cols.firstCol]) : "";
  const lastRaw = cols.lastCol ? cellString(row[cols.lastCol]) : "";
  const contactRaw = cols.contactCol ? cellString(row[cols.contactCol]) : "";

  const hasContactIntent = Boolean(firstRaw || lastRaw || contactRaw);
  if (!hasContactIntent) {
    return { first_name: null, last_name: null, hasContactIntent: false };
  }

  if (firstRaw || lastRaw) {
    return {
      first_name: firstRaw || null,
      last_name: lastRaw || null,
      hasContactIntent: true,
    };
  }

  const split = splitName(contactRaw);
  const first = split.first_name === "Unknown" && !contactRaw ? null : split.first_name;
  const last = split.last_name || null;
  return {
    first_name: first?.trim() || null,
    last_name: last?.trim() || null,
    hasContactIntent: true,
  };
}

export function mapSpreadsheetObjectToImportRow(
  row: Record<string, unknown>,
  cols: ConsultingTargetListColumnMap,
  rowNumber: number
): { row: ConsultingTargetListImportRow | null; error?: string } {
  const company_name = cellString(row[cols.companyCol]);
  if (!company_name) {
    return { row: null };
  }

  const matchRaw = cols.matchScoreCol ? row[cols.matchScoreCol] : null;
  const match_score = parseOptionalMatchScore(matchRaw);
  if (matchRaw != null && cellString(matchRaw) !== "" && match_score == null) {
    return {
      row: null,
      error: `Row ${rowNumber}: invalid Match Score "${String(matchRaw)}"`,
    };
  }

  const { first_name, last_name, hasContactIntent } = resolveContactNamesForImport(row, cols);
  const emailRaw = cols.emailCol ? row[cols.emailCol] : null;
  const { email, linkedin_url } = parseEmailAndLinkedin(emailRaw);

  let resolvedFirst = first_name;
  let resolvedLast = last_name;
  if (hasContactIntent && !resolvedFirst) {
    resolvedFirst = null;
    resolvedLast = null;
  }

  return {
    row: {
      company_name,
      industry_category: cols.industryCategoryCol
        ? cellString(row[cols.industryCategoryCol]) || null
        : null,
      website: cols.websiteCol ? cellString(row[cols.websiteCol]) || null : null,
      match_score,
      company_description: cols.companyDescriptionCol
        ? cellString(row[cols.companyDescriptionCol]) || null
        : null,
      personal_notes: cols.personalNotesCol
        ? cellString(row[cols.personalNotesCol]) || null
        : null,
      hq_phone: cols.hqPhoneCol ? cellString(row[cols.hqPhoneCol]) || null : null,
      first_name: resolvedFirst,
      last_name: resolvedLast,
      role: cols.titleCol ? cellString(row[cols.titleCol]) || null : null,
      email,
      linkedin_url,
    },
  };
}

export function parseConsultingTargetListObjects(
  objects: Record<string, unknown>[]
): ConsultingTargetListParseResult {
  if (objects.length === 0) {
    return { rows: [], errors: ["No rows found in spreadsheet"] };
  }

  const headers = Object.keys(objects[0] ?? {});
  const colMap = buildConsultingTargetListColumnMap(headers);
  if ("error" in colMap) {
    return { rows: [], errors: [colMap.error] };
  }

  const rows: ConsultingTargetListImportRow[] = [];
  const errors: string[] = [];

  objects.forEach((obj, idx) => {
    const rowNumber = idx + 2;
    const mapped = mapSpreadsheetObjectToImportRow(obj, colMap, rowNumber);
    if (mapped.error) errors.push(mapped.error);
    if (mapped.row) rows.push(mapped.row);
  });

  return { rows, errors };
}

export async function parseConsultingTargetListSpreadsheet(
  buffer: Buffer
): Promise<ConsultingTargetListParseResult> {
  const workbook = await readXlsxFile(buffer);
  const sheetRows = (workbook[0]?.data ?? []) as unknown[][];
  const objects = rowsToObjects(sheetRows);
  return parseConsultingTargetListObjects(objects);
}

function normalizeContactKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}||${last.trim().toLowerCase()}`;
}

async function upsertConsultingContact(
  supabaseAdmin: SupabaseClient,
  params: {
    consultingProfileId: string;
    userId: string;
    companyId: string;
    row: ConsultingTargetListImportRow;
  }
): Promise<"inserted" | "updated" | "skipped"> {
  const first_name = String(params.row.first_name ?? "").trim();
  if (!first_name) return "skipped";

  const last_name = apolloLastNameForStorage(String(params.row.last_name ?? ""));
  const email = params.row.email?.trim().toLowerCase() || null;
  const role = params.row.role ?? null;
  const linkedin_url = params.row.linkedin_url ?? null;

  let existingQuery = supabaseAdmin
    .from("crm_contacts")
    .select("contact_id, email, linkedin_url, role, first_name, last_name")
    .eq("company_id", params.companyId)
    .eq("consulting_profile_id", params.consultingProfileId)
    .eq("archived", false);

  const { data: existingRows, error: listErr } = await existingQuery;
  if (listErr) throw new Error(listErr.message);

  let existing: (typeof existingRows)[number] | undefined;
  if (email) {
    existing = (existingRows ?? []).find(
      (c) => c.email && String(c.email).trim().toLowerCase() === email
    );
  }
  if (!existing) {
    const key = normalizeContactKey(first_name, last_name);
    existing = (existingRows ?? []).find(
      (c) => normalizeContactKey(String(c.first_name ?? ""), String(c.last_name ?? "")) === key
    );
  }

  const payload = {
    company_id: params.companyId,
    created_by_user_id: params.userId,
    consulting_profile_id: params.consultingProfileId,
    first_name,
    last_name,
    role,
    email,
    linkedin_url: linkedin_url ?? existing?.linkedin_url ?? null,
    archived: false,
  };

  if (existing?.contact_id) {
    const { error } = await supabaseAdmin
      .from("crm_contacts")
      .update({
        first_name: payload.first_name,
        last_name: payload.last_name,
        role: payload.role ?? existing.role,
        email: payload.email ?? existing.email,
        linkedin_url: payload.linkedin_url,
      })
      .eq("contact_id", existing.contact_id);
    if (error) throw new Error(error.message);
    return "updated";
  }

  const { error: insertErr } = await supabaseAdmin.from("crm_contacts").insert(payload);
  if (insertErr) throw new Error(insertErr.message);
  return "inserted";
}

export async function upsertConsultingTargetListRows(
  supabaseAdmin: SupabaseClient,
  params: {
    consultingProfileId: string;
    userId: string;
    rows: ConsultingTargetListImportRow[];
  }
): Promise<ConsultingTargetListUpsertSummary> {
  const summary: ConsultingTargetListUpsertSummary = {
    processed: 0,
    companies_upserted: 0,
    contacts_inserted: 0,
    contacts_updated: 0,
    skipped: 0,
    row_errors: [],
  };

  for (const row of params.rows) {
    summary.processed++;
    const companyName = row.company_name.trim();
    if (!companyName) {
      summary.skipped++;
      continue;
    }

    try {
      const companyId = await getOrCreateCompanyByName(supabaseAdmin, companyName);
      const websiteHint = row.website?.trim() || null;

      if (websiteHint) {
        try {
          await resolveCompanyWebsiteForTargetList(
            supabaseAdmin,
            companyId,
            { companyName, websiteHint },
            { userId: params.userId }
          );
        } catch {
          // non-fatal
        }
        if (isApolloEnabled()) {
          try {
            await persistApolloMetadataForCompany(supabaseAdmin, companyId, {
              website: websiteHint,
            });
          } catch {
            // non-fatal
          }
        }
      }

      const companyPatch: Record<string, string> = {};
      if (row.industry_category?.trim()) {
        companyPatch.product_category = row.industry_category.trim();
      }
      if (row.hq_phone?.trim()) {
        companyPatch.hq_phone = row.hq_phone.trim();
      }
      const firmographicsPatch = firmographicsPatchFromImportRow(row);
      const mergedCompanyPatch = { ...companyPatch, ...firmographicsPatch };
      if (Object.keys(mergedCompanyPatch).length > 0) {
        const { error: companyErr } = await supabaseAdmin
          .from("companies")
          .update(mergedCompanyPatch)
          .eq("company_id", companyId);
        if (companyErr) throw new Error(companyErr.message);
      }

      const { error: listErr } = await supabaseAdmin.from("consulting_target_list").upsert(
        {
          consulting_profile_id: params.consultingProfileId,
          company_id: companyId,
          industry_category: row.industry_category?.trim() || null,
          match_score: row.match_score ?? null,
          company_description: row.company_description ?? null,
          personal_notes: row.personal_notes ?? null,
          added_by_user_id: params.userId,
        },
        { onConflict: "consulting_profile_id,company_id" }
      );
      if (listErr) throw new Error(listErr.message);
      summary.companies_upserted++;

      if (row.first_name?.trim()) {
        const contactResult = await upsertConsultingContact(supabaseAdmin, {
          consultingProfileId: params.consultingProfileId,
          userId: params.userId,
          companyId,
          row,
        });
        if (contactResult === "inserted") summary.contacts_inserted++;
        else if (contactResult === "updated") summary.contacts_updated++;
      }
    } catch (e) {
      summary.skipped++;
      summary.row_errors.push(
        e instanceof Error ? `${companyName}: ${e.message}` : `${companyName}: import failed`
      );
    }
  }

  return summary;
}

export function normalizeJsonImportRow(raw: Record<string, unknown>): ConsultingTargetListImportRow | null {
  const company_name = String(raw.company_name ?? raw.name ?? raw.brand ?? "").trim();
  if (!company_name) return null;

  const firstRaw = raw.first_name != null ? String(raw.first_name).trim() : "";
  const lastRaw = raw.last_name != null ? String(raw.last_name).trim() : "";
  const contactRaw =
    raw.contact != null
      ? String(raw.contact).trim()
      : raw.contact_name != null
        ? String(raw.contact_name).trim()
        : "";

  let first_name: string | null = firstRaw || null;
  let last_name: string | null = lastRaw || null;
  if (!first_name && !last_name && contactRaw) {
    const split = splitName(contactRaw);
    first_name = split.first_name === "Unknown" ? null : split.first_name;
    last_name = split.last_name || null;
  }

  const emailField = raw.email ?? raw.email_linkedin;
  const { email, linkedin_url } = parseEmailAndLinkedin(emailField);

  return {
    company_name,
    industry_category:
      raw.industry_category != null
        ? String(raw.industry_category).trim() || null
        : raw.category != null
          ? String(raw.category).trim() || null
          : null,
    website: raw.website != null ? String(raw.website).trim() || null : null,
    match_score: parseOptionalMatchScore(raw.match_score),
    company_description:
      raw.company_description != null ? String(raw.company_description) : null,
    personal_notes: raw.personal_notes != null ? String(raw.personal_notes) : null,
    hq_phone: raw.hq_phone != null ? String(raw.hq_phone).trim() || null : null,
    first_name,
    last_name,
    role:
      raw.role != null
        ? String(raw.role).trim() || null
        : raw.title != null
          ? String(raw.title).trim() || null
          : null,
    email: email ?? (raw.email != null ? String(raw.email).trim() || null : null),
    linkedin_url:
      linkedin_url ??
      (raw.linkedin_url != null ? String(raw.linkedin_url).trim() || null : null),
    ...mapCompanyFirmographics(raw),
  };
}
