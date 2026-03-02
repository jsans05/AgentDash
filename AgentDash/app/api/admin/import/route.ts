import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";

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
  "creatoriq_publisher_id": "creatoriq_publisher_id",
  "creatoriq id": "creatoriq_publisher_id",
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
    let rows: Record<string, unknown>[];

    if (name.endsWith(".csv")) {
      const text = new TextDecoder().decode(buffer);
      const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
      rows = parsed.data ?? [];
    } else {
      const sheetRows = await readXlsxFile(buffer);
      rows = rowsToObjects(sheetRows as unknown[][]);
    }

    const supabase = await createServerClient();
    const created: Record<string, number> = {};
    if (type === "athletes") {
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
            creatoriq_publisher_id: row.creatoriq_publisher_id != null ? String(row.creatoriq_publisher_id).trim() || null : null,
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
      // Import contracts. Columns: athlete_name, sponsor_name, category, contract_start, contract_end, agent (optional).
      // Multiple rows per athlete_name = multiple contracts (supported).
      let imported = 0;
      let skippedNoAthlete = 0;
      let skippedNoData = 0;
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
          if (!firstInsertError) firstInsertError = error.message;
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
        insert_error: firstInsertError ?? undefined,
        import_errors: importErrors.length > 0 ? importErrors : undefined,
        debug,
      });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: any) {
    const message = error?.message ?? (typeof error === "string" ? error : "Import failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
