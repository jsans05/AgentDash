import type { SupabaseClient } from "@supabase/supabase-js";
import readXlsxFile from "read-excel-file/node";
import { splitName } from "@/lib/import/name-match";
import {
  buildConsultingTargetListColumnMap,
  coerceSpreadsheetCell,
  mapSpreadsheetObjectToImportRow,
  rowsToObjects,
  type ConsultingTargetListImportRow,
  type ConsultingTargetListParseResult,
} from "@/lib/consulting/import-target-list";
import { apolloLastNameForStorage } from "@/lib/crm/contact-display-name";
import { canonicalizeCompanyCategory } from "@/lib/crm/company-category";
import { contactsLikelySamePerson } from "@/lib/crm/target-list-duplicate-contacts";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";
import {
  addCompaniesToCrmList,
  getOrCreateCrmListByName,
} from "@/lib/crm/crm-lists-server";

export type CrmProspectImportRow = ConsultingTargetListImportRow;

export type CrmProspectImportSummary = {
  processed: number;
  companies: number;
  cards_created: number;
  cards_updated: number;
  contacts_inserted: number;
  contacts_updated: number;
  skipped: number;
  row_errors: string[];
  list_id?: string | null;
  list_name?: string | null;
  members_added?: number;
};

/**
 * Parse a general CRM prospect spreadsheet (no athlete). Supports the common
 * headers: Category, Company, NOTE, Contact Name, Role, Email, LinkedIn,
 * Company Website — plus legacy First/Last / Email/Linkedin layouts.
 * Forward-fills Category and Company for merged-cell sheets.
 */
export async function parseCrmProspectSpreadsheet(
  buffer: Buffer
): Promise<ConsultingTargetListParseResult> {
  const workbook = await readXlsxFile(buffer);
  const sheetRows = (workbook[0]?.data ?? []) as unknown[][];
  const objects = rowsToObjects(sheetRows);
  if (objects.length === 0) {
    return { rows: [], errors: ["No rows found in spreadsheet"] };
  }

  const headers = Object.keys(objects[0] ?? {});
  const colMap = buildConsultingTargetListColumnMap(headers);
  if ("error" in colMap) {
    return { rows: [], errors: [colMap.error] };
  }

  let lastCompany = "";
  let lastCategory = "";
  for (const obj of objects) {
    const hasAnyValue = Object.values(obj).some((v) => coerceSpreadsheetCell(v) !== "");
    if (!hasAnyValue) continue;

    const company = coerceSpreadsheetCell(obj[colMap.companyCol]);
    if (colMap.industryCategoryCol) {
      const category = coerceSpreadsheetCell(obj[colMap.industryCategoryCol]);
      if (category) {
        if (lastCategory && category.toLowerCase() !== lastCategory.toLowerCase() && !company) {
          lastCompany = "";
        }
        lastCategory = category;
        obj[colMap.industryCategoryCol] = canonicalizeCompanyCategory(category) ?? category;
      } else if (lastCategory) {
        obj[colMap.industryCategoryCol] =
          canonicalizeCompanyCategory(lastCategory) ?? lastCategory;
      }
    }

    if (company) lastCompany = company;
    else if (lastCompany) obj[colMap.companyCol] = lastCompany;
  }

  const rows: CrmProspectImportRow[] = [];
  const errors: string[] = [];
  objects.forEach((obj, idx) => {
    const mapped = mapSpreadsheetObjectToImportRow(obj, colMap, idx + 2);
    if (mapped.error) errors.push(mapped.error);
    if (mapped.row) rows.push(mapped.row);
  });

  return { rows, errors };
}

type CompanyGroup = {
  company_name: string;
  first: CrmProspectImportRow;
  contacts: CrmProspectImportRow[];
};

function groupRowsByCompany(rows: CrmProspectImportRow[]): CompanyGroup[] {
  const byKey = new Map<string, CompanyGroup>();
  for (const row of rows) {
    const name = row.company_name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const group = byKey.get(key);
    if (!group) {
      byKey.set(key, { company_name: name, first: row, contacts: [row] });
    } else {
      group.contacts.push(row);
    }
  }
  return [...byKey.values()];
}

function normalizeContactKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()}||${last.trim().toLowerCase()}`;
}

async function findOrCreateCompany(
  supabaseAdmin: SupabaseClient,
  group: CompanyGroup
): Promise<{ companyId: string; company: Record<string, unknown> }> {
  const name = group.company_name;
  const { data: matches, error } = await supabaseAdmin
    .from("companies")
    .select("company_id, name, website, hq_phone, product_category")
    .ilike("name", name.replace(/([%_\\])/g, "\\$1"))
    .limit(10);
  if (error) throw new Error(error.message);

  const exact = (matches ?? []).find(
    (r) => String(r?.name ?? "").trim().toLowerCase() === name.toLowerCase()
  );
  const picked = exact ?? (matches ?? [])[0] ?? null;
  if (picked?.company_id) {
    return { companyId: String(picked.company_id), company: picked };
  }

  const { data: created, error: insErr } = await supabaseAdmin
    .from("companies")
    .insert({
      name,
      industry: null,
      website: group.first.website?.trim() || null,
      hq_phone: group.first.hq_phone?.trim() || null,
      product_category:
        canonicalizeCompanyCategory(group.first.industry_category) || "Uncategorized",
    })
    .select("company_id, name, website, hq_phone, product_category")
    .single();
  if (insErr) throw new Error(insErr.message);
  return { companyId: String(created!.company_id), company: created! };
}

async function upsertContact(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    row: CrmProspectImportRow;
  }
): Promise<"inserted" | "updated" | "skipped"> {
  const email = params.row.email?.trim().toLowerCase() || null;
  let first_name = String(params.row.first_name ?? "").trim();
  let last_name = apolloLastNameForStorage(String(params.row.last_name ?? ""));

  if (!first_name && !email) return "skipped";

  if (!first_name && email) {
    const local = email.split("@")[0] ?? "";
    const split = splitName(local.replace(/[._+-]/g, " "));
    first_name = split.first_name !== "Unknown" ? split.first_name : "Contact";
    last_name = apolloLastNameForStorage(split.last_name || last_name || ".");
  }

  const { data: existingRows, error: listErr } = await supabaseAdmin
    .from("crm_contacts")
    .select("contact_id, email, phone, linkedin_url, role, first_name, last_name, notes")
    .eq("company_id", params.companyId)
    .eq("created_by_user_id", params.userId)
    .eq("archived", false);
  if (listErr) throw new Error(listErr.message);

  let existing: (typeof existingRows)[number] | undefined;
  if (email) {
    existing = (existingRows ?? []).find(
      (c) => c.email && String(c.email).trim().toLowerCase() === email
    );
  }
  if (!existing && first_name) {
    const key = normalizeContactKey(first_name, last_name);
    existing = (existingRows ?? []).find(
      (c) => normalizeContactKey(String(c.first_name ?? ""), String(c.last_name ?? "")) === key
    );
  }
  if (!existing && first_name) {
    existing = (existingRows ?? []).find((c) =>
      contactsLikelySamePerson(
        { first_name, last_name },
        { first_name: String(c.first_name ?? ""), last_name: String(c.last_name ?? "") }
      )
    );
  }

  const role = params.row.role?.trim() || null;
  const phone = params.row.phone?.trim() || null;
  const linkedin_url = params.row.linkedin_url?.trim() || null;
  const notes = params.row.personal_notes?.trim() || null;

  if (existing?.contact_id) {
    const updatePatch: Record<string, unknown> = {
      first_name,
      last_name,
      role: role ?? existing.role,
      email: email ?? existing.email,
      phone: phone ?? existing.phone,
      linkedin_url: linkedin_url ?? existing.linkedin_url,
      notes: notes ?? existing.notes,
    };
    const { error } = await supabaseAdmin
      .from("crm_contacts")
      .update(updatePatch)
      .eq("contact_id", existing.contact_id);
    if (error) throw new Error(error.message);
    return "updated";
  }

  const { error: insertErr } = await supabaseAdmin.from("crm_contacts").insert({
    company_id: params.companyId,
    created_by_user_id: params.userId,
    first_name,
    last_name,
    role,
    email,
    phone,
    linkedin_url,
    notes,
    outreach_mode: "email",
    archived: false,
  });
  if (insertErr) throw new Error(insertErr.message);
  return "inserted";
}

/**
 * Import parsed rows into the caller's CRM: companies, pipeline cards (no
 * athlete — appears under Pipeline Unassigned), and contacts.
 */
export async function importCrmProspectRows(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    rows: CrmProspectImportRow[];
    listId?: string | null;
    newListName?: string | null;
  }
): Promise<CrmProspectImportSummary> {
  const summary: CrmProspectImportSummary = {
    processed: params.rows.length,
    companies: 0,
    cards_created: 0,
    cards_updated: 0,
    contacts_inserted: 0,
    contacts_updated: 0,
    skipped: 0,
    row_errors: [],
    list_id: null,
    list_name: null,
    members_added: 0,
  };

  const groups = groupRowsByCompany(params.rows);
  const importedCompanyIds: string[] = [];

  for (const group of groups) {
    try {
      const { companyId, company } = await findOrCreateCompany(supabaseAdmin, group);
      importedCompanyIds.push(companyId);
      summary.companies += 1;

      const companyPatch: Record<string, unknown> = {};
      if (group.first.hq_phone?.trim() && !company.hq_phone) {
        companyPatch.hq_phone = group.first.hq_phone.trim();
      }
      if (group.first.industry_category?.trim()) {
        companyPatch.product_category =
          canonicalizeCompanyCategory(group.first.industry_category) ??
          group.first.industry_category.trim();
      }
      if (Object.keys(companyPatch).length > 0) {
        const { error: coErr } = await supabaseAdmin
          .from("companies")
          .update(companyPatch)
          .eq("company_id", companyId);
        if (coErr) throw new Error(coErr.message);
      }

      const websiteHint = group.first.website?.trim() || null;
      if (websiteHint) {
        try {
          await resolveCompanyWebsiteForTargetList(
            supabaseAdmin,
            companyId,
            { companyName: group.company_name, websiteHint },
            { userId: params.userId }
          );
        } catch {
          // non-fatal
        }
      }

      const { data: existingCard, error: cardErr } = await supabaseAdmin
        .from("crm_companies_pipeline")
        .select("id, personal_notes, company_description, archived")
        .eq("company_id", companyId)
        .eq("created_by_user_id", params.userId)
        .maybeSingle();
      if (cardErr) throw new Error(cardErr.message);

      const noteFromSheet = group.first.personal_notes?.trim() || null;

      if (existingCard?.id) {
        const patch: Record<string, unknown> = {};
        if (existingCard.archived) {
          patch.archived = false;
          patch.pipeline_stage = "target";
        }
        if (noteFromSheet && !existingCard.personal_notes) {
          patch.personal_notes = noteFromSheet;
        }
        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await supabaseAdmin
            .from("crm_companies_pipeline")
            .update(patch)
            .eq("id", existingCard.id);
          if (upErr) throw new Error(upErr.message);
        }
        summary.cards_updated += 1;
      } else {
        const { error: insErr } = await supabaseAdmin.from("crm_companies_pipeline").insert({
          company_id: companyId,
          created_by_user_id: params.userId,
          status: "in_progress",
          pipeline_stage: "target",
          potential_athletes: [],
          personal_notes: noteFromSheet,
        });
        if (insErr) throw new Error(insErr.message);
        summary.cards_created += 1;
      }

      for (const contactRow of group.contacts) {
        if (!contactRow.first_name?.trim() && !contactRow.email?.trim()) continue;
        const result = await upsertContact(supabaseAdmin, {
          userId: params.userId,
          companyId,
          row: contactRow,
        });
        if (result === "inserted") summary.contacts_inserted += 1;
        else if (result === "updated") summary.contacts_updated += 1;
        else summary.skipped += 1;
      }
    } catch (e) {
      summary.skipped += 1;
      summary.row_errors.push(
        e instanceof Error
          ? `${group.company_name}: ${e.message}`
          : `${group.company_name}: import failed`
      );
    }
  }

  const wantsList = Boolean(params.listId || params.newListName?.trim());
  if (wantsList && importedCompanyIds.length > 0) {
    try {
      let listId = params.listId ?? null;
      let listName = params.newListName?.trim() ?? null;
      if (!listId && listName) {
        const list = await getOrCreateCrmListByName(supabaseAdmin, {
          userId: params.userId,
          name: listName,
        });
        listId = list.id;
        listName = list.name;
      } else if (listId) {
        const { data: listRow } = await supabaseAdmin
          .from("crm_lists")
          .select("name")
          .eq("id", listId)
          .eq("created_by_user_id", params.userId)
          .maybeSingle();
        listName = listRow?.name ?? listName;
      }
      if (listId) {
        const { added } = await addCompaniesToCrmList(supabaseAdmin, {
          listId,
          userId: params.userId,
          companyIds: importedCompanyIds,
        });
        summary.list_id = listId;
        summary.list_name = listName;
        summary.members_added = added;
      }
    } catch (e) {
      summary.row_errors.push(
        e instanceof Error ? `List membership: ${e.message}` : "List membership failed"
      );
    }
  }

  return summary;
}
