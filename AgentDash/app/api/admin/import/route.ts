import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { findAthleteByTalentOrName } from "@/lib/athletes/lookup";
import {
  normalizeAudienceRow,
  normalizeSocialRow,
  type ImportRowFailure,
  type SheetImportSummary,
} from "@/lib/import/social-audience";

function rowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? ""));
  return rows.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

/** Map common Excel/CSV header names to athlete import fields (case-insensitive). */
const ATHLETE_HEADER_MAP: Record<string, string> = {
  "first name": "first_name",
  "firstname": "first_name",
  "last name": "last_name",
  "lastname": "last_name",
  "sport": "sport",
  "agent": "agent",
  "agents": "agents",
  "agent email": "agent_email",
  "agent_email": "agent_email",
  "agent_id": "agent_id",
  "country": "country",
  "country of origin": "country",
  "city": "city",
  "state": "state",
  "accolades": "accolades",
};

function normalizeAthleteRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = ATHLETE_HEADER_MAP[String(key).toLowerCase().trim()] ?? key;
    out[normalizedKey] = value;
  }
  return out;
}

/** Map common Excel headers to contract import fields (case-insensitive). */
const CONTRACT_HEADER_MAP: Record<string, string> = {
  "athlete_name": "athlete_name",
  "athlete name": "athlete_name",
  "sponsor_name": "sponsor_name",
  "sponsor name": "sponsor_name",
  "company_name": "company_name",
  "company name": "company_name",
  "category": "category",
  "exclusivity_category": "exclusivity_category",
  "exclusivity category": "exclusivity_category",
  "contract_start": "contract_start",
  "contract start": "contract_start",
  "start_date": "start_date",
  "start date": "start_date",
  "contract_end": "contract_end",
  "contract end": "contract_end",
  "end_date": "end_date",
  "end date": "end_date",
  "agent": "agent",
  "status": "status",
  "notes": "notes",
};

function normalizeContractRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = CONTRACT_HEADER_MAP[String(key).toLowerCase().trim()] ?? key;
    out[normalizedKey] = value;
  }
  return out;
}

/** Get value from a row by trying normalized key then any key matching pattern (for flexible Excel headers). */
function getContractField(row: Record<string, unknown>, normalizedKey: string, pattern: RegExp): string {
  const v = row[normalizedKey];
  if (v != null && String(v).trim() !== "") return String(v).trim();
  const entry = Object.entries(row).find(([k]) => pattern.test(String(k).toLowerCase()));
  if (entry && entry[1] != null && String(entry[1]).trim() !== "") return String(entry[1]).trim();
  return "";
}

/** Normalize value to YYYY-MM-DD or null (handles Excel serial, Date objects, M/D/YY, and locale date strings). */
function toDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const d = new Date((value - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const [, month, day, year] = mdy;
    const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
    const m = month.padStart(2, "0");
    const d = day.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return s;
}

/** Get athlete PK from a row (handles both athlete_id and id for schema compatibility). */
function athletePk(row: { athlete_id?: string; id?: string } | null): string | null {
  if (!row) return null;
  return row.athlete_id ?? row.id ?? null;
}

/** Resolve athlete by name: "First Last", "Last, First", or partial match. Uses .limit(1) so duplicate names still match. */
async function resolveAthleteByName(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  nameStr: string
): Promise<string | null> {
  const raw = String(nameStr ?? "").trim().replace(/\s+/g, " ").replace(/\u00A0/g, " ");
  if (!raw) return null;
  const sel = "*";

  function firstRow(res: { data: unknown }): { athlete_id?: string; id?: string } | null {
    const d = res.data;
    if (Array.isArray(d) && d.length > 0) return d[0] as { athlete_id?: string; id?: string };
    if (d && typeof d === "object" && !Array.isArray(d)) return d as { athlete_id?: string; id?: string };
    return null;
  }

  // Try "Last, First"
  if (raw.includes(",")) {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[0] ?? "";
      const first = parts.slice(1).join(" ").trim();
      const { data } = await supabase
        .from("athletes")
        .select(sel)
        .ilike("first_name", first)
        .ilike("last_name", last)
        .limit(1);
      const row = firstRow({ data });
      if (row) return athletePk(row);
    }
  }
  const parts = raw.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const last = parts.slice(1).join(" ");
    let res = await supabase
      .from("athletes")
      .select(sel)
      .ilike("first_name", first)
      .ilike("last_name", last)
      .limit(1);
    let row = firstRow(res);
    if (row) return athletePk(row);
    const lastFirst = parts[parts.length - 1] ?? "";
    const firstRest = parts.slice(0, -1).join(" ");
    res = await supabase
      .from("athletes")
      .select(sel)
      .ilike("first_name", lastFirst)
      .ilike("last_name", firstRest)
      .limit(1);
    row = firstRow(res);
    if (row) return athletePk(row);
  }
  if (parts.length === 1) {
    const res = await supabase
      .from("athletes")
      .select(sel)
      .or(`first_name.ilike.%${parts[0]}%,last_name.ilike.%${parts[0]}%`)
      .limit(1);
    const row = firstRow(res);
    if (row) return athletePk(row);
  }
  return null;
}

type NameResolution = {
  athlete_id: string | null;
  ambiguous: boolean;
};

function normalizeForNameMatch(raw: string): string {
  const lowered = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics

  // Drop parentheticals like "(JD)"
  const noParen = lowered.replace(/\([^)]*\)/g, " ");

  // Normalize punctuation/quotes/hyphens to spaces
  return noParen
    .replace(/[\"'’`]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFromImportName(rawName: string): string[] {
  // Handle "Last, First" by swapping
  if (rawName.includes(",")) {
    const [lastPart, ...rest] = rawName.split(",");
    const firstPart = rest.join(","); // includes any commas after the first; unlikely but safe
    const swapped = normalizeForNameMatch(`${firstPart} ${lastPart}`);
    return swapped ? swapped.split(" ").filter(Boolean) : [];
  }

  const normalized = normalizeForNameMatch(rawName);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function tokensFromAthleteRow(firstName: string | null, lastName: string | null): string[] {
  return tokensFromImportName(`${firstName ?? ""} ${lastName ?? ""}`);
}

function tokensSubsetMatch(aTokens: string[], bTokens: string[]): boolean {
  if (aTokens.length < 2 || bTokens.length < 2) return false;

  const aFirst = aTokens[0];
  const aLast = aTokens[aTokens.length - 1];
  const bFirst = bTokens[0];
  const bLast = bTokens[bTokens.length - 1];

  // Keep first/last stable; drop middle differences via subset matching
  if (aFirst !== bFirst || aLast !== bLast) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  const aSubsetB = [...aSet].every((t) => bSet.has(t));
  const bSubsetA = [...bSet].every((t) => aSet.has(t));
  return aSubsetB || bSubsetA;
}

async function resolveAthleteBySocialAudienceExcelName(
  supabase: Awaited<ReturnType<typeof createServerClient>> ,
  nameStr: string
): Promise<NameResolution> {
  const tokens = tokensFromImportName(nameStr);
  if (tokens.length < 2) return { athlete_id: null, ambiguous: false };

  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;

  const { data: candidates, error } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name")
    .ilike("first_name", `%${first}%`)
    .ilike("last_name", `%${last}%`)
    .limit(50);

  if (error) {
    return { athlete_id: null, ambiguous: false };
  }

  const matches = (candidates ?? []).filter((c: any) => {
    const candTokens = tokensFromAthleteRow(c.first_name, c.last_name);
    return tokensSubsetMatch(tokens, candTokens);
  });

  if (matches.length === 1) return { athlete_id: matches[0]!.athlete_id, ambiguous: false };
  if (matches.length === 0) return { athlete_id: null, ambiguous: false };
  return { athlete_id: null, ambiguous: true };
}

/** Resolve one agent string (email, UUID, or "First Last" name) to profile user_id. */
async function resolveAgentValue(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  agentValue: string
): Promise<string | null> {
  const v = agentValue.trim();
  if (!v) return null;
  if (v.includes("@")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", v.toLowerCase())
      .eq("role", "agent")
      .maybeSingle();
    return profile?.user_id ?? null;
  }
  if (/^[0-9a-f-]{36}$/i.test(v)) return v;
  const nameParts = v.split(/\s+/).filter(Boolean);
  if (nameParts.length >= 2) {
    const agentFirst = nameParts[0] ?? "";
    const agentLast = nameParts.slice(1).join(" ");
    let { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("role", "agent")
      .ilike("first_name", agentFirst)
      .ilike("last_name", agentLast)
      .maybeSingle();
    if (!profile) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name")
        .eq("role", "agent")
        .or(`first_name.ilike.%${agentFirst}%,last_name.ilike.%${agentLast}%`)
        .limit(5);
      profile = profiles?.find(
        (p) =>
          p.first_name?.toLowerCase() === agentFirst.toLowerCase() &&
          p.last_name?.toLowerCase() === agentLast.toLowerCase()
      ) ?? profiles?.[0] ?? null;
    }
    return profile?.user_id ?? null;
  }
  return null;
}

function splitName(raw: string | null | undefined): { first_name: string; last_name: string } {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return { first_name: "Unknown", last_name: "" };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) {
    return { first_name: parts[0] ?? "Unknown", last_name: "" };
  }
  const first_name = parts[0] ?? "";
  const last_name = parts.slice(1).join(" ");
  return { first_name, last_name };
}

async function ensureAthleteForImport(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  rawName: string | null | undefined
): Promise<string | null> {
  const name = (rawName ?? "").trim();
  if (!name) return null;

  // 1) Prefer matching by Name on the existing roster.
  const resolution = await resolveAthleteBySocialAudienceExcelName(supabase, name);
  if (resolution.athlete_id) return resolution.athlete_id;

  // If the name could match multiple roster athletes, skip instead of auto-creating duplicates.
  if (resolution.ambiguous) return null;

  // 2) If still not found, auto-create a simple athlete row.
  const { first_name, last_name } = splitName(name);

  const { data: inserted, error: insertErr } = await supabase
    .from("athletes")
    .insert({
      first_name,
      last_name,
      sport: null,
      current_agent_id: null,
      city: null,
      state: null,
      country: null,
      accolades: [],
    })
    .select("athlete_id")
    .single();

  if (insertErr) {
    console.warn("[Import social_audience] Failed to auto-create athlete", {
      name,
      error: insertErr.message,
    });
    return null;
  }

  return (inserted as any)?.athlete_id ?? null;
}

export async function POST(req: Request) {
  try {
    await requireRole("admin");
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = (file.name || "").toLowerCase();

    console.log("[Admin Import] Starting import", {
      type,
      fileName: file.name,
      size: buffer.length,
    });

    const supabase = await createServerClient();
    const created: Record<string, number> = {};
    if (type === "athletes") {
      let rows: Record<string, unknown>[];
      if (name.endsWith(".csv")) {
        const text = new TextDecoder().decode(buffer);
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        rows = parsed.data ?? [];
      } else {
        const sheetRows = await readXlsxFile(buffer);
        rows = rowsToObjects(sheetRows as unknown[][]);
      }
      // Import athletes (supports: First Name, Last Name, Sport, Agent, Country of Origin, plus optional columns)
      let imported = 0;
      for (const rawRow of rows) {
        const row = normalizeAthleteRow(rawRow as Record<string, unknown>) as any;

        const firstName = row.first_name != null ? String(row.first_name).trim() : "";
        const lastName = row.last_name != null ? String(row.last_name).trim() : "";
        if (!firstName || !lastName) continue;

        // Support multiple agents: "Agent" or "Agents" column, comma- or semicolon-separated
        const agentCell =
          row.agents != null ? String(row.agents) : row.agent != null ? String(row.agent) : row.agent_email ?? row.agent_id ?? "";
        const agentStrings = (agentCell ?? "")
          .split(/[,;]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        const agentIds: string[] = [];
        for (const v of agentStrings) {
          const id = await resolveAgentValue(supabase, v);
          if (id && !agentIds.includes(id)) agentIds.push(id);
          else if (!id && v) {
            console.warn(`[Import] ${firstName} ${lastName}: no agent found for "${v}"`);
          }
        }
        const primaryAgentId = agentIds[0] ?? null;

        const accolades = row.accolades
          ? String(row.accolades).split(";").map((s: string) => s.trim()).filter(Boolean)
          : [];

        const { data: inserted, error } = await supabase
          .from("athletes")
          .insert({
            first_name: firstName,
            last_name: lastName,
            sport: row.sport != null ? String(row.sport).trim() || null : null,
            current_agent_id: primaryAgentId,
            city: row.city != null ? String(row.city).trim() || null : null,
            state: row.state != null ? String(row.state).trim() || null : null,
            country: row.country != null ? String(row.country).trim() || null : null,
            accolades,
          })
          .select("athlete_id, id")
          .single();

        if (error) continue;
        const insertedId = athletePk(inserted);
        if (!insertedId) continue;
        imported++;

        // Link all resolved agents (first = primary; trigger will sync current_agent_id)
        for (let i = 0; i < agentIds.length; i++) {
          await supabase.from("athlete_agents").insert({
            athlete_id: insertedId,
            user_id: agentIds[i],
            is_primary: i === 0,
          });
        }
      }

      return NextResponse.json({ imported, created });
    } else if (type === "contracts") {
      let rows: Record<string, unknown>[];
      if (name.endsWith(".csv")) {
        const text = new TextDecoder().decode(buffer);
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        rows = parsed.data ?? [];
      } else {
        const sheetRows = await readXlsxFile(buffer);
        rows = rowsToObjects(sheetRows as unknown[][]);
      }
      // Import contracts. Columns: athlete_name, sponsor_name, category, contract_start, contract_end, agent (optional).
      // Multiple rows per athlete_name = multiple contracts (supported).
      let imported = 0;
      let skippedNoAthlete = 0;
      let skippedNoData = 0;
      let skippedDuplicateContract = 0;
      let firstInsertError: string | null = null;
      const importErrors: { row: number; athleteName: string; sponsorName: string; category: string; reason: string }[] = [];
      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1)
        .single();

      if (!adminProfile?.user_id) {
        return NextResponse.json(
          { error: "No admin user found. Create an admin profile so contracts can be assigned created_by_user_id." },
          { status: 400 }
        );
      }

      const firstRawRow = (rows[0] as Record<string, unknown>) || {};
      const rowKeysFromFile = Object.keys(firstRawRow);
      const { count: athletesCount } = await supabase.from("athletes").select("*", { count: "exact", head: true }).limit(1);

      let lastAthleteName = "";
      let debug: { first_athlete_name?: string; first_athlete_found?: boolean; row_keys?: string[]; athletes_in_db?: number } = {
        row_keys: rowKeysFromFile,
        athletes_in_db: athletesCount ?? undefined,
      };
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const rawRow = rows[rowIndex] as Record<string, unknown>;
        const rawRecord = rawRow;
        const row = normalizeContractRow(rawRecord) as any;
        const rawAthleteName = getContractField(row, "athlete_name", /athlete.*name|name.*athlete/) || getContractField(rawRecord, "athlete_name", /athlete/);
        if (rawAthleteName) lastAthleteName = rawAthleteName;
        const athleteName = rawAthleteName || lastAthleteName;
        const sponsorName = getContractField(row, "sponsor_name", /sponsor|company/) || getContractField(rawRecord, "sponsor_name", /sponsor|company/);
        const categoryName = (row.category ?? row.exclusivity_category) != null ? String(row.category ?? row.exclusivity_category).trim() : "";

        if (!sponsorName && !athleteName) continue;
        if (!athleteName || !sponsorName) {
          skippedNoData++;
          continue;
        }

        const athleteId = await resolveAthleteByName(supabase, athleteName);
        if (Object.keys(debug).length === 0) {
          debug = { first_athlete_name: athleteName, first_athlete_found: !!athleteId };
        }
        if (!athleteId) {
          skippedNoAthlete++;
          console.warn(`[Import contracts] Athlete not found: "${athleteName}"`);
          continue;
        }

        // Resolve athlete sport for taxonomy
        const { data: athleteRow } = await supabase
          .from("athletes")
          .select("sport")
          .eq("athlete_id", athleteId)
          .single();
        const athleteSport = athleteRow?.sport ?? null;

        // Map category to taxonomy (case/whitespace-insensitive); if unknown and taxonomy has Unknown use it, else flag error
        const { resolveCategoryToTaxonomy, taxonomyHasUnknown } = await import("@/lib/taxonomy");
        const rawCategory = categoryName || "";
        let resolvedCategory: string | null = null;
        if (rawCategory.trim()) {
          resolvedCategory = await resolveCategoryToTaxonomy(athleteSport, rawCategory);
        }
        if (rawCategory.trim() && !resolvedCategory) {
          const allowUnknown = await taxonomyHasUnknown(athleteSport);
          if (allowUnknown) resolvedCategory = "Unknown";
        }
        if (rawCategory.trim() && !resolvedCategory) {
          importErrors.push({ row: rowIndex + 1, athleteName, sponsorName, category: rawCategory, reason: "Category not in taxonomy for this athlete's sport" });
          continue;
        }
        const categoryForInsert = resolvedCategory ?? (await taxonomyHasUnknown(athleteSport) ? "Unknown" : null);
        if (!categoryForInsert) {
          importErrors.push({ row: rowIndex + 1, athleteName, sponsorName, category: rawCategory || "(empty)", reason: "No taxonomy for athlete sport and Unknown not in taxonomy" });
          continue;
        }

        // Ensure athlete has the agent from the sheet (if provided)
        const agentValue = row.agent != null ? String(row.agent).trim() : "";
        if (agentValue) {
          const agentId = await resolveAgentValue(supabase, agentValue);
          if (agentId) {
            const { error: linkErr } = await supabase.from("athlete_agents").insert({
              athlete_id: athleteId,
              user_id: agentId,
              is_primary: false,
            });
            if (linkErr?.code !== "23505") {
              // 23505 = unique violation, already linked
            }
          }
        }

        // Get or create company (sponsor)
        let companyId: string;
        const { data: existingCompany } = await supabase
          .from("companies")
          .select("company_id")
          .eq("name", sponsorName)
          .maybeSingle();

        if (existingCompany) {
          companyId = existingCompany.company_id;
        } else {
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({ name: sponsorName, industry: null })
            .select("company_id")
            .single();
          companyId = newCompany!.company_id;
          created.companies = (created.companies || 0) + 1;
        }

        const startDate = toDateString(row.contract_start ?? row.start_date);
        const endDate = toDateString(row.contract_end ?? row.end_date);
        const status = row.status ? String(row.status).toLowerCase() : "active";
        const validStatus = ["active", "expired", "terminated"].includes(status) ? status : "active";

        const { error } = await supabase.from("contracts").insert({
          athlete_id: athleteId,
          company_id: companyId,
          category: categoryForInsert,
          start_date: startDate,
          end_date: endDate,
          status: validStatus,
          notes: row.notes ? String(row.notes).trim() || null : null,
          created_by_user_id: adminProfile.user_id,
        });

        if (error) {
          if (error.code === "23505") {
            skippedDuplicateContract++;
          } else if (!firstInsertError) {
            firstInsertError = error.message;
          }
        } else {
          imported++;
        }
      }

      return NextResponse.json({
        imported,
        created,
        total_rows: rows.length,
        skipped_no_athlete: skippedNoAthlete,
        skipped_no_data: skippedNoData,
        skipped_duplicate_contract: skippedDuplicateContract || undefined,
        insert_error: firstInsertError ?? undefined,
        import_errors: importErrors.length > 0 ? importErrors : undefined,
        debug,
      });
    } else if (type === "social_audience") {
      if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
        return NextResponse.json(
          { error: "Social & Audience import requires an .xlsx Excel workbook with two sheets." },
          { status: 400 }
        );
      }

      // First, get sheet metadata (names only)
      const workbook = await readXlsxFile(buffer, { getSheets: true });
      const sheetNames = workbook.map((s) => String(s.name ?? ""));

      const requiredSheets: Array<"Social Data" | "Audience Data"> = ["Social Data", "Audience Data"];
      const missingSheets = requiredSheets.filter(
        (s) => !sheetNames.some((n) => n.trim().toLowerCase() === s.toLowerCase())
      );
      if (missingSheets.length > 0) {
        return NextResponse.json(
          {
            error: `Missing required sheet(s): ${missingSheets.join(
              ", "
            )}. Expected sheets named "Social Data" and "Audience Data".`,
          },
          { status: 400 }
        );
      }

      // read-excel-file with getSheets only returns metadata; we must re-read each sheet by name.
      const socialSheetMeta = workbook.find(
        (s) => String(s.name ?? "").trim().toLowerCase() === "social data".toLowerCase()
      );
      const audienceSheetMeta = workbook.find(
        (s) => String(s.name ?? "").trim().toLowerCase() === "audience data".toLowerCase()
      );

      const socialSheetName = String(socialSheetMeta?.name ?? "Social Data");
      const audienceSheetName = String(audienceSheetMeta?.name ?? "Audience Data");

      const socialSheetRows = await readXlsxFile(buffer, { sheet: socialSheetName });
      const audienceSheetRows = await readXlsxFile(buffer, { sheet: audienceSheetName });

      const socialRowsRaw = rowsToObjects(
        socialSheetRows as unknown[][]
      ) as Record<string, unknown>[];
      const audienceRowsRaw = rowsToObjects(
        audienceSheetRows as unknown[][]
      ) as Record<string, unknown>[];

      console.log("[Admin Import] Parsed sheets", {
        socialSheetName,
        audienceSheetName,
        socialRows: socialRowsRaw.length,
        audienceRows: audienceRowsRaw.length,
      });

      const failures: ImportRowFailure[] = [];
      const socialSummary: SheetImportSummary = {
        sheet: "Social Data",
        total: socialRowsRaw.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      const audienceSummary: SheetImportSummary = {
        sheet: "Audience Data",
        total: audienceRowsRaw.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };

      const sourceFileName = file.name || null;

      // Process Social Data sheet
      for (let idx = 0; idx < socialRowsRaw.length; idx++) {
        const rawRow = socialRowsRaw[idx] as Record<string, unknown>;
        const rowIndex = idx + 2; // +2 to account for header and 1-based Excel rows

        try {
          const parsed = normalizeSocialRow(rawRow);
          if (!parsed.name_raw) {
            socialSummary.skipped++;
            failures.push({
              sheet: "Social Data",
              rowIndex,
              reason: "Missing Name",
            });
            continue;
          }

          let athleteId = await ensureAthleteForImport(supabase, parsed.name_raw);
          if (!athleteId) {
            socialSummary.skipped++;
            failures.push({
              sheet: "Social Data",
              rowIndex,
              reason:
                "Could not find or create athlete from Talent ID / Name. Please check the row and try again.",
            });
            continue;
          }

          const { data: existing, error: fetchErr } = await supabase
            .from("athlete_social_data")
            .select("id")
            .eq("athlete_id", athleteId)
            .maybeSingle();

          if (fetchErr) {
            socialSummary.failed++;
            failures.push({
              sheet: "Social Data",
              rowIndex,
              reason: `Database error: ${fetchErr.message}`,
            });
            continue;
          }

          const payload = {
            athlete_id: athleteId,
            talent_id: parsed.talent_id,
            name_raw: parsed.name_raw,
            total_followers: parsed.total_followers,
            avg_er_20p: parsed.avg_er_20p,
            total_lifetime_posts: parsed.total_lifetime_posts,
            ig_followers: parsed.ig_followers,
            avg_er_ig_20p: parsed.avg_er_ig_20p,
            ig_lifetime_posts: parsed.ig_lifetime_posts,
            tt_followers: parsed.tt_followers,
            avg_er_tt_20p: parsed.avg_er_tt_20p,
            tt_lifetime_posts: parsed.tt_lifetime_posts,
            fb_followers: parsed.fb_followers,
            avg_er_fb_20p: parsed.avg_er_fb_20p,
            fb_lifetime_posts: parsed.fb_lifetime_posts,
            x_followers: parsed.x_followers,
            avg_er_x_20p: parsed.avg_er_x_20p,
            x_lifetime_posts: parsed.x_lifetime_posts,
            source_file_name: sourceFileName,
          };

          if (existing?.id) {
            const { error: updateErr } = await supabase
              .from("athlete_social_data")
              .update({
                ...payload,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            if (updateErr) {
              socialSummary.failed++;
              failures.push({
                sheet: "Social Data",
                rowIndex,
                reason: `Update failed: ${updateErr.message}`,
              });
            } else {
              socialSummary.updated++;
            }
          } else {
            const { error: insertErr } = await supabase
              .from("athlete_social_data")
              .insert({
                ...payload,
              });
            if (insertErr) {
              socialSummary.failed++;
              failures.push({
                sheet: "Social Data",
                rowIndex,
                reason: `Insert failed: ${insertErr.message}`,
              });
            } else {
              socialSummary.inserted++;
            }
          }
        } catch (e: any) {
          socialSummary.failed++;
          failures.push({
            sheet: "Social Data",
            rowIndex,
            reason: e?.message ?? "Unexpected error while processing row",
          });
        }
      }

      // Process Audience Data sheet
      for (let idx = 0; idx < audienceRowsRaw.length; idx++) {
        const rawRow = audienceRowsRaw[idx] as Record<string, unknown>;
        const rowIndex = idx + 2;

        try {
          const parsed = normalizeAudienceRow(rawRow);
          if (!parsed.name_raw) {
            audienceSummary.skipped++;
            failures.push({
              sheet: "Audience Data",
              rowIndex,
              reason: "Missing Name",
            });
            continue;
          }

          if (!parsed.audience_name) {
            audienceSummary.skipped++;
            failures.push({
              sheet: "Audience Data",
              rowIndex,
              reason: "Missing Audience Name",
            });
            continue;
          }

          let athleteId = await ensureAthleteForImport(supabase, parsed.name_raw);
          if (!athleteId) {
            audienceSummary.skipped++;
            failures.push({
              sheet: "Audience Data",
              rowIndex,
              reason:
                "Could not find or create athlete from Name. Please check the row and try again.",
            });
            continue;
          }

          if (!parsed.audience_category) {
            audienceSummary.skipped++;
            failures.push({
              sheet: "Audience Data",
              rowIndex,
              reason: "Audience Category is missing or invalid",
            });
            continue;
          }

          const { data: existing, error: fetchErr } = await supabase
            .from("athlete_audience_data")
            .select("id")
            .eq("athlete_id", athleteId)
            .eq("audience_category", parsed.audience_category)
            .eq("audience_name", parsed.audience_name)
            .maybeSingle();

          if (fetchErr) {
            audienceSummary.failed++;
            failures.push({
              sheet: "Audience Data",
              rowIndex,
              reason: `Database error: ${fetchErr.message}`,
            });
            continue;
          }

          const payload = {
            athlete_id: athleteId,
            talent_id: parsed.talent_id,
            name_raw: parsed.name_raw,
            audience_category: parsed.audience_category,
            audience_name: parsed.audience_name,
            ig_audience_percent: parsed.ig_audience_percent,
            ig_audience_count: parsed.ig_audience_count,
            current_ig_following: parsed.current_ig_following,
            source_file_name: sourceFileName,
          };

          if (existing?.id) {
            const { error: updateErr } = await supabase
              .from("athlete_audience_data")
              .update({
                ...payload,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            if (updateErr) {
              audienceSummary.failed++;
              failures.push({
                sheet: "Audience Data",
                rowIndex,
                reason: `Update failed: ${updateErr.message}`,
              });
            } else {
              audienceSummary.updated++;
            }
          } else {
            const { error: insertErr } = await supabase
              .from("athlete_audience_data")
              .insert({
                ...payload,
              });
            if (insertErr) {
              audienceSummary.failed++;
              failures.push({
                sheet: "Audience Data",
                rowIndex,
                reason: `Insert failed: ${insertErr.message}`,
              });
            } else {
              audienceSummary.inserted++;
            }
          }
        } catch (e: any) {
          audienceSummary.failed++;
          failures.push({
            sheet: "Audience Data",
            rowIndex,
            reason: e?.message ?? "Unexpected error while processing row",
          });
        }
      }

      const totalSummary = {
        total_rows: socialSummary.total + audienceSummary.total,
        inserted: socialSummary.inserted + audienceSummary.inserted,
        updated: socialSummary.updated + audienceSummary.updated,
        skipped: socialSummary.skipped + audienceSummary.skipped,
        failed: socialSummary.failed + audienceSummary.failed,
        imported: socialSummary.inserted + socialSummary.updated + audienceSummary.inserted + audienceSummary.updated,
        sheets: [socialSummary, audienceSummary],
        failures,
      };

      console.log("[Admin Import] Completed social_audience import", totalSummary);

      return NextResponse.json(totalSummary);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: any) {
    const message = error?.message ?? (typeof error === "string" ? error : "Import failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
