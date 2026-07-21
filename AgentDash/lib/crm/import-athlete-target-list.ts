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
import {
  canonicalizeCompanyCategory,
  isEffectivelyUncategorizedCompanyCategory,
} from "@/lib/crm/company-category";
import {
  mergeAthleteIntoPotentialAthletes,
  type PotentialAthleteEntry,
} from "@/lib/crm/potential-athletes";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";

export type AthleteTargetListImportRow = ConsultingTargetListImportRow;

export type AthleteTargetListImportSummary = {
  processed: number;
  companies: number;
  cards_created: number;
  cards_updated: number;
  contacts_inserted: number;
  contacts_existing: number;
  row_errors: string[];
};

/**
 * Parse a target-list spreadsheet for an athlete. Reuses the consulting
 * column mapping (Category, Company/Brand, Contact Name, Role/Title, Email,
 * LinkedIn, …) and additionally forward-fills Category and Company for
 * merged-cell style sheets where only the first contact row of each brand
 * carries those values.
 */
export async function parseAthleteTargetListSpreadsheet(
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

  // Forward-fill merged Category / Company cells. When a new Category value
  // appears, stop carrying the previous company name across the section break.
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

  const rows: AthleteTargetListImportRow[] = [];
  const errors: string[] = [];
  objects.forEach((obj, idx) => {
    const mapped = mapSpreadsheetObjectToImportRow(obj, colMap, idx + 2);
    if (mapped.error) errors.push(mapped.error);
    if (mapped.row) rows.push(mapped.row);
  });

  return { rows, errors };
}

/**
 * Unlink the athlete from every pipeline card owned by `userId` only.
 * Prefer {@link clearAthleteFromAllTargetListCards} for Excel replace flows.
 */
export async function clearAthleteFromOwnTargetListCards(
  supabase: SupabaseClient,
  userId: string,
  athleteId: string
): Promise<{ cleared: number; archived: number }> {
  return clearAthleteFromTargetListCards(supabase, athleteId, { ownerUserId: userId });
}

/**
 * Unlink the athlete from every pipeline card on the shared target list
 * (all owners). Used by Excel replace so the list becomes exactly the upload,
 * owned by the importer — teammate leftovers like old product-line brands do
 * not keep appearing under "All".
 */
export async function clearAthleteFromAllTargetListCards(
  supabaseAdmin: SupabaseClient,
  athleteId: string
): Promise<{ cleared: number; archived: number }> {
  return clearAthleteFromTargetListCards(supabaseAdmin, athleteId, {});
}

async function clearAthleteFromTargetListCards(
  supabase: SupabaseClient,
  athleteId: string,
  opts: { ownerUserId?: string }
): Promise<{ cleared: number; archived: number }> {
  const PAGE = 1000;
  const cards: Array<{
    id: string;
    potential_athletes: unknown;
    archived: boolean | null;
    created_by_user_id?: string;
  }> = [];

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("crm_companies_pipeline")
      .select("id, potential_athletes, archived, created_by_user_id")
      .contains("potential_athletes", JSON.stringify([{ athlete_id: athleteId }]))
      .range(from, from + PAGE - 1);
    if (opts.ownerUserId) {
      query = query.eq("created_by_user_id", opts.ownerUserId);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = data ?? [];
    cards.push(...page);
    if (page.length < PAGE) break;
  }

  let cleared = 0;
  let archivedCount = 0;
  for (const card of cards) {
    const list = Array.isArray(card.potential_athletes) ? card.potential_athletes : [];
    const next = list.filter(
      (p: { athlete_id?: string }) => String(p?.athlete_id ?? "") !== athleteId
    );
    // Skip if already absent (shouldn't happen with contains filter, but safe).
    if (next.length === list.length) continue;

    const patch: Record<string, unknown> = { potential_athletes: next };
    const shouldArchive = next.length === 0 && card.archived !== true;
    if (shouldArchive) patch.archived = true;

    let update = supabase.from("crm_companies_pipeline").update(patch).eq("id", card.id);
    if (opts.ownerUserId) {
      update = update.eq("created_by_user_id", opts.ownerUserId);
    }
    const { error: upErr } = await update;
    if (upErr) throw new Error(upErr.message);
    cleared += 1;
    if (shouldArchive) archivedCount += 1;
  }

  return { cleared, archived: archivedCount };
}

type CompanyGroup = {
  company_name: string;
  first: AthleteTargetListImportRow;
  contacts: AthleteTargetListImportRow[];
};

function groupRowsByCompany(rows: AthleteTargetListImportRow[]): CompanyGroup[] {
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
      product_category: group.first.industry_category?.trim() || "Uncategorized",
    })
    .select("company_id, name, website, hq_phone, product_category")
    .single();
  if (insErr) throw new Error(insErr.message);
  return { companyId: String(created!.company_id), company: created! };
}

async function insertContactsForCompany(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    companyId: string;
    rows: AthleteTargetListImportRow[];
  }
): Promise<{ inserted: number; existing: number }> {
  const candidates = params.rows.filter((r) => r.first_name?.trim() || r.email?.trim());
  if (candidates.length === 0) return { inserted: 0, existing: 0 };

  const { data: existingContacts, error } = await supabaseAdmin
    .from("crm_contacts")
    .select("contact_id, first_name, last_name, email, role, phone, linkedin_url")
    .eq("company_id", params.companyId)
    .eq("created_by_user_id", params.userId)
    .eq("archived", false);
  if (error) throw new Error(error.message);

  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const nameKey = (first: unknown, last: unknown) => `name:${norm(first)}||${norm(last)}`;
  const emailKey = (email: unknown) => {
    const e = norm(email);
    return e ? `email:${e}` : "";
  };

  type ExistingContact = {
    contact_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    role: string | null;
    phone: string | null;
    linkedin_url: string | null;
  };
  const byKey = new Map<string, ExistingContact>();
  for (const c of existingContacts ?? []) {
    const row = c as ExistingContact;
    const nk = nameKey(row.first_name, row.last_name);
    byKey.set(nk, row);
    const ek = emailKey(row.email);
    if (ek) byKey.set(ek, row);
  }

  let inserted = 0;
  let existing = 0;
  for (const row of candidates) {
    const email = row.email?.trim().toLowerCase() || null;
    let first = String(row.first_name ?? "").trim();
    let last = apolloLastNameForStorage(String(row.last_name ?? ""));

    if (!first && email) {
      const local = email.split("@")[0] ?? "";
      const split = splitName(local.replace(/[._+-]/g, " "));
      first = split.first_name !== "Unknown" ? split.first_name : "Contact";
      last = apolloLastNameForStorage(split.last_name || last || ".");
    }
    if (!first) continue;

    const nk = nameKey(first, last);
    const ek = emailKey(email);
    const matched = (ek && byKey.get(ek)) || byKey.get(nk) || null;
    if (matched?.contact_id) {
      // Fill blank fields from the sheet; never wipe agent-authored values.
      const updatePatch: Record<string, string | null> = {};
      if (row.role?.trim() && !matched.role) updatePatch.role = row.role.trim();
      if (email && !matched.email) updatePatch.email = email;
      if (row.phone?.trim() && !matched.phone) updatePatch.phone = row.phone.trim();
      if (row.linkedin_url?.trim() && !matched.linkedin_url) {
        updatePatch.linkedin_url = row.linkedin_url.trim();
      }
      if (Object.keys(updatePatch).length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from("crm_contacts")
          .update(updatePatch)
          .eq("contact_id", matched.contact_id);
        if (upErr) throw new Error(upErr.message);
      }
      existing += 1;
      continue;
    }

    const { error: insErr } = await supabaseAdmin.from("crm_contacts").insert({
      company_id: params.companyId,
      created_by_user_id: params.userId,
      first_name: first,
      last_name: last,
      role: row.role?.trim() || null,
      email,
      phone: row.phone?.trim() || null,
      linkedin_url: row.linkedin_url?.trim() || null,
      outreach_mode: "email",
    });
    if (insErr) throw new Error(insErr.message);

    const stub = {
      contact_id: "new",
      first_name: first,
      last_name: last,
      email,
      role: row.role?.trim() || null,
      phone: row.phone?.trim() || null,
      linkedin_url: row.linkedin_url?.trim() || null,
    } as ExistingContact;
    byKey.set(nk, stub);
    if (ek) byKey.set(ek, stub);
    inserted += 1;
  }

  return { inserted, existing };
}

/**
 * Import parsed spreadsheet rows into an athlete's target list: upsert
 * companies, link the athlete on the importing user's pipeline cards, and add
 * the user's contacts. Company-level fields are only filled when blank so
 * agent-authored data is never overwritten.
 */
export async function importAthleteTargetListRows(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    athlete: PotentialAthleteEntry;
    rows: AthleteTargetListImportRow[];
  }
): Promise<AthleteTargetListImportSummary> {
  const summary: AthleteTargetListImportSummary = {
    processed: params.rows.length,
    companies: 0,
    cards_created: 0,
    cards_updated: 0,
    contacts_inserted: 0,
    contacts_existing: 0,
    row_errors: [],
  };

  const groups = groupRowsByCompany(params.rows);

  for (const group of groups) {
    try {
      const { companyId, company } = await findOrCreateCompany(supabaseAdmin, group);
      summary.companies += 1;

      // Fill missing company fields; always apply spreadsheet category on Excel import
      // so brands land under the category the sheet specifies.
      const companyPatch: Record<string, unknown> = {};
      if (group.first.hq_phone?.trim() && !company.hq_phone) {
        companyPatch.hq_phone = group.first.hq_phone.trim();
      }
      if (group.first.industry_category?.trim()) {
        companyPatch.product_category =
          canonicalizeCompanyCategory(group.first.industry_category) ??
          group.first.industry_category.trim();
      } else if (isEffectivelyUncategorizedCompanyCategory(company.product_category)) {
        companyPatch.product_category = "Uncategorized";
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
          // non-fatal: website can be filled manually later
        }
      }

      // Pipeline card scoped per user: unique (company_id, created_by_user_id).
      const { data: existingCard, error: cardErr } = await supabaseAdmin
        .from("crm_companies_pipeline")
        .select("id, potential_athletes, company_description, personal_notes, archived")
        .eq("company_id", companyId)
        .eq("created_by_user_id", params.userId)
        .maybeSingle();
      if (cardErr) throw new Error(cardErr.message);

      const athleteEntry: PotentialAthleteEntry = {
        ...params.athlete,
        ...(group.first.match_score != null ? { match_score: group.first.match_score } : {}),
      };

      if (existingCard?.id) {
        const merged = mergeAthleteIntoPotentialAthletes(
          existingCard.potential_athletes,
          athleteEntry
        );
        const patch: Record<string, unknown> = { potential_athletes: merged.next };
        if (existingCard.archived) {
          // Restore into the kanban the same way the pipeline API does.
          patch.archived = false;
          patch.pipeline_stage = "target";
        }
        if (group.first.company_description?.trim() && !existingCard.company_description) {
          patch.company_description = group.first.company_description.trim();
        }
        if (group.first.personal_notes?.trim() && !existingCard.personal_notes) {
          patch.personal_notes = group.first.personal_notes.trim();
        }
        const { error: upErr } = await supabaseAdmin
          .from("crm_companies_pipeline")
          .update(patch)
          .eq("id", existingCard.id);
        if (upErr) throw new Error(upErr.message);
        summary.cards_updated += 1;
      } else {
        const { error: insErr } = await supabaseAdmin.from("crm_companies_pipeline").insert({
          company_id: companyId,
          created_by_user_id: params.userId,
          status: "in_progress",
          pipeline_stage: "target",
          potential_athletes: [athleteEntry],
          company_description: group.first.company_description?.trim() || null,
          personal_notes: group.first.personal_notes?.trim() || null,
        });
        if (insErr) throw new Error(insErr.message);
        summary.cards_created += 1;
      }

      const contactResult = await insertContactsForCompany(supabaseAdmin, {
        userId: params.userId,
        companyId,
        rows: group.contacts,
      });
      summary.contacts_inserted += contactResult.inserted;
      summary.contacts_existing += contactResult.existing;
    } catch (e) {
      summary.row_errors.push(
        e instanceof Error
          ? `${group.company_name}: ${e.message}`
          : `${group.company_name}: import failed`
      );
    }
  }

  return summary;
}
