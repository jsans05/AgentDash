/**
 * Parse Metabase monthly export workbooks (Roster / Social / Audience sheets).
 * Supports real .xlsx workbooks and Metabase CSV downloads (often mislabeled .xlsx).
 */

import {
  detectAudienceDataHeader,
  detectSocialDataHeader,
  findHeaderRowIndex,
  rowsToObjects,
  sheetRowsToObjects,
} from "@/lib/import/excel-sheet";
import {
  AUDIENCE_HEADER_ALIASES,
  SOCIAL_HEADER_ALIASES,
  toStringOrNull,
} from "@/lib/import/social-audience";
import { normalizeForNameMatch, splitName } from "@/lib/import/name-match";
import Papa from "papaparse";
import readXlsxFile, { readSheet } from "read-excel-file/node";

export type MetabaseSheetKind = "Roster" | "Social" | "Audience";

export type MetabaseRosterRow = {
  display_name: string;
  sport: string | null;
  file_agent: string | null;
  rowIndex: number;
};

export type MetabaseParsedWorkbook = {
  sheetNames: string[];
  sheets: { roster: boolean; social: boolean; audience: boolean };
  roster: MetabaseRosterRow[];
  socialRows: Record<string, unknown>[];
  socialHeaderRowIndex: number;
  audienceRows: Record<string, unknown>[];
  audienceHeaderRowIndex: number;
  rosterHeaders: string[];
  socialHeaders: string[];
  audienceHeaders: string[];
};

export type MetabaseUploadPart = {
  buffer: Buffer;
  fileName: string;
  /** When set, force which sheet this file represents (e.g. form field roster/social/audience). */
  kindHint?: MetabaseSheetKind | null;
};

const IGNORED_ROSTER_HEADERS = new Set([
  "in salesforce?",
  "in salesforce",
  "in w3?",
  "in w3",
]);

const ROSTER_HEADER_MAP: Record<string, string> = {
  name: "name",
  agent: "agent",
  agents: "agent",
  sport: "sport",
};

export function metabaseCreateKey(displayName: string): string {
  return normalizeForNameMatch(displayName);
}

export function detectMetabaseRosterHeader(cells: string[]): boolean {
  return (
    cells.some((c) => c === "name") &&
    (cells.some((c) => c === "sport") || cells.some((c) => c === "agent" || c === "agents"))
  );
}

function findSheetName(sheetNames: string[], ...candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = sheetNames.find((s) => {
      const n = s.trim().toLowerCase();
      const c = candidate.toLowerCase();
      return n === c || n.includes(c);
    });
    if (found) return found;
  }
  return null;
}

function cell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  for (const [k, v] of Object.entries(row)) {
    const nk = k.toLowerCase().trim();
    if (keys.some((want) => want === nk) && v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function normalizeRosterObject(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = String(rawKey).toLowerCase().trim();
    if (IGNORED_ROSTER_HEADERS.has(key)) continue;
    const mapped = ROSTER_HEADER_MAP[key];
    if (mapped) out[mapped] = value;
  }
  return out;
}

export function buildHeaderMapping(params: {
  rosterHeaders: string[];
  socialHeaders: string[];
  audienceHeaders: string[];
}): Array<{ sheet: string; source: string; target: string | "ignored" }> {
  const mapping: Array<{ sheet: string; source: string; target: string | "ignored" }> = [];

  for (const source of params.rosterHeaders) {
    const key = source.toLowerCase().trim();
    if (!key) continue;
    if (IGNORED_ROSTER_HEADERS.has(key)) {
      mapping.push({ sheet: "Roster", source, target: "ignored" });
    } else if (ROSTER_HEADER_MAP[key]) {
      mapping.push({ sheet: "Roster", source, target: ROSTER_HEADER_MAP[key]! });
    } else {
      mapping.push({ sheet: "Roster", source, target: "ignored" });
    }
  }

  for (const source of params.socialHeaders) {
    const key = source.toLowerCase().trim();
    if (!key) continue;
    const target = SOCIAL_HEADER_ALIASES[key];
    mapping.push({
      sheet: "Social",
      source,
      target: target ?? "ignored",
    });
  }

  for (const source of params.audienceHeaders) {
    const key = source.toLowerCase().trim();
    if (!key) continue;
    const target = AUDIENCE_HEADER_ALIASES[key];
    mapping.push({
      sheet: "Audience",
      source,
      target: target ?? "ignored",
    });
  }

  return mapping;
}

/** True zip/xlsx signature starts with PK (0x50 0x4B). */
export function looksLikeXlsxZip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Heuristic: text that looks like CSV/TSV with a Name header. */
export function looksLikeCsvText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8");
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim()) ?? "";
  if (!firstLine) return false;
  const lower = firstLine.toLowerCase();
  if (!lower.includes("name")) return false;
  return firstLine.includes(",") || firstLine.includes("\t") || lower.includes("agent") || lower.includes("followers");
}

function parseCsvToRows(buffer: Buffer): unknown[][] {
  // Strip UTF-8 BOM if present
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });
  if (parsed.errors?.length && (!parsed.data || parsed.data.length === 0)) {
    const firstError = parsed.errors[0] as { message?: string } | undefined;
    throw new Error(`CSV parse failed: ${firstError?.message ?? "unknown error"}`);
  }
  return (parsed.data ?? []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => (cell == null ? "" : cell))
  );
}

function emptyParsed(): MetabaseParsedWorkbook {
  return {
    sheetNames: [],
    sheets: { roster: false, social: false, audience: false },
    roster: [],
    socialRows: [],
    socialHeaderRowIndex: 0,
    audienceRows: [],
    audienceHeaderRowIndex: 0,
    rosterHeaders: [],
    socialHeaders: [],
    audienceHeaders: [],
  };
}

function mergeParsed(into: MetabaseParsedWorkbook, part: MetabaseParsedWorkbook): MetabaseParsedWorkbook {
  return {
    sheetNames: [...into.sheetNames, ...part.sheetNames],
    sheets: {
      roster: into.sheets.roster || part.sheets.roster,
      social: into.sheets.social || part.sheets.social,
      audience: into.sheets.audience || part.sheets.audience,
    },
    roster: part.sheets.roster ? part.roster : into.roster,
    socialRows: part.sheets.social ? part.socialRows : into.socialRows,
    socialHeaderRowIndex: part.sheets.social ? part.socialHeaderRowIndex : into.socialHeaderRowIndex,
    audienceRows: part.sheets.audience ? part.audienceRows : into.audienceRows,
    audienceHeaderRowIndex: part.sheets.audience
      ? part.audienceHeaderRowIndex
      : into.audienceHeaderRowIndex,
    rosterHeaders: part.sheets.roster ? part.rosterHeaders : into.rosterHeaders,
    socialHeaders: part.sheets.social ? part.socialHeaders : into.socialHeaders,
    audienceHeaders: part.sheets.audience ? part.audienceHeaders : into.audienceHeaders,
  };
}

function inferKindFromHeaders(headerCells: string[]): MetabaseSheetKind | null {
  if (detectAudienceDataHeader(headerCells)) return "Audience";
  if (detectSocialDataHeader(headerCells)) return "Social";
  if (detectMetabaseRosterHeader(headerCells)) return "Roster";
  // Name-only roster fallthrough (e.g. Name + In Salesforce without Sport/Agent in first row)
  if (headerCells.some((c) => c === "name")) {
    if (headerCells.some((c) => c.includes("audience"))) return "Audience";
    if (headerCells.some((c) => c.includes("follower") || c.includes("er (20"))) return "Social";
    return "Roster";
  }
  return null;
}

function inferKindFromFileName(fileName: string): MetabaseSheetKind | null {
  const n = fileName.toLowerCase();
  if (n.includes("audience")) return "Audience";
  if (n.includes("social") || n.includes("owned")) return "Social";
  if (n.includes("roster") || n.includes("talent")) return "Roster";
  return null;
}

function parseRosterFromRows(rows: unknown[][]): Pick<
  MetabaseParsedWorkbook,
  "roster" | "rosterHeaders" | "sheets"
> & { sheetNames: string[] } {
  const headerRowIndex = findHeaderRowIndex(rows, (cells) =>
    cells.some((c) => c === "name")
  );
  const rosterHeaders = (rows[headerRowIndex] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
  const objects = rowsToObjects(rows, headerRowIndex);
  const roster: MetabaseRosterRow[] = [];
  for (let i = 0; i < objects.length; i++) {
    const normalized = normalizeRosterObject(objects[i]!);
    const display_name = toStringOrNull(normalized.name);
    if (!display_name) continue;
    roster.push({
      display_name,
      sport: toStringOrNull(normalized.sport),
      file_agent: toStringOrNull(normalized.agent),
      rowIndex: headerRowIndex + i + 2,
    });
  }
  return {
    sheetNames: ["Roster"],
    sheets: { roster: true, social: false, audience: false },
    roster,
    rosterHeaders,
  };
}

function parseSocialFromRows(rows: unknown[][]): Pick<
  MetabaseParsedWorkbook,
  "socialRows" | "socialHeaderRowIndex" | "socialHeaders" | "sheets"
> & { sheetNames: string[] } {
  const parsed = sheetRowsToObjects(rows, detectSocialDataHeader);
  const socialHeaders = (rows[parsed.headerRowIndex] ?? [])
    .map((h) => String(h ?? "").trim())
    .filter(Boolean);
  return {
    sheetNames: ["Social Data"],
    sheets: { roster: false, social: true, audience: false },
    socialRows: parsed.objects,
    socialHeaderRowIndex: parsed.headerRowIndex,
    socialHeaders,
  };
}

function parseAudienceFromRows(rows: unknown[][]): Pick<
  MetabaseParsedWorkbook,
  "audienceRows" | "audienceHeaderRowIndex" | "audienceHeaders" | "sheets"
> & { sheetNames: string[] } {
  const parsed = sheetRowsToObjects(rows, detectAudienceDataHeader);
  const audienceHeaders = (rows[parsed.headerRowIndex] ?? [])
    .map((h) => String(h ?? "").trim())
    .filter(Boolean);
  return {
    sheetNames: ["Audience Data"],
    sheets: { roster: false, social: false, audience: true },
    audienceRows: parsed.objects,
    audienceHeaderRowIndex: parsed.headerRowIndex,
    audienceHeaders,
  };
}

function sheetPartFromKind(
  kind: MetabaseSheetKind,
  rows: unknown[][]
): MetabaseParsedWorkbook {
  const base = emptyParsed();
  if (kind === "Roster") {
    const part = parseRosterFromRows(rows);
    return {
      ...base,
      ...part,
      sheets: { ...base.sheets, ...part.sheets },
    };
  }
  if (kind === "Social") {
    const part = parseSocialFromRows(rows);
    return {
      ...base,
      ...part,
      sheets: { ...base.sheets, ...part.sheets },
    };
  }
  const part = parseAudienceFromRows(rows);
  return {
    ...base,
    ...part,
    sheets: { ...base.sheets, ...part.sheets },
  };
}

function formatInvalidSignatureHint(buffer: Buffer, fileName: string): string {
  const hex = buffer.subarray(0, 4).toString("hex");
  const sample = buffer.subarray(0, 40).toString("utf8").replace(/\s+/g, " ").trim();
  return (
    `Could not read "${fileName}" as Excel (.xlsx). File signature: 0x${hex}. ` +
    `Metabase "Download" is often CSV — re-download as .csv, or combine sheets into a real .xlsx workbook. ` +
    `(preview: "${sample.slice(0, 60)}${sample.length > 60 ? "…" : ""}")`
  );
}

async function parseXlsxMultiSheet(buffer: Buffer): Promise<MetabaseParsedWorkbook> {
  const workbook = await readXlsxFile(buffer);
  const sheetNames = workbook.map((sheet) => String(sheet.sheet ?? ""));

  const rosterSheetName = findSheetName(
    sheetNames,
    "action sports roster",
    "roster",
    "talent roster"
  );
  const socialSheetName = findSheetName(
    sheetNames,
    "action sports - owned social",
    "owned social",
    "social data",
    "social"
  );
  const audienceSheetName = findSheetName(
    sheetNames,
    "action sports - audience",
    "audience data",
    "audience"
  );

  let out = emptyParsed();
  out.sheetNames = sheetNames;

  if (rosterSheetName) {
    const rows = (await readSheet(buffer, rosterSheetName)) as unknown[][];
    out = mergeParsed(out, sheetPartFromKind("Roster", rows));
  }
  if (socialSheetName) {
    const rows = (await readSheet(buffer, socialSheetName)) as unknown[][];
    out = mergeParsed(out, sheetPartFromKind("Social", rows));
  }
  if (audienceSheetName) {
    const rows = (await readSheet(buffer, audienceSheetName)) as unknown[][];
    out = mergeParsed(out, sheetPartFromKind("Audience", rows));
  }

  // Single-sheet xlsx with no matching names: infer from headers
  if (!out.sheets.roster && !out.sheets.social && !out.sheets.audience && sheetNames.length === 1) {
    const rows = (await readSheet(buffer, sheetNames[0]!)) as unknown[][];
    const headerIdx = findHeaderRowIndex(rows, () => true);
    const headerCells = (rows[headerIdx] ?? []).map((c) =>
      String(c ?? "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
    );
    const kind = inferKindFromHeaders(headerCells);
    if (kind) out = mergeParsed(out, sheetPartFromKind(kind, rows));
  }

  return out;
}

async function parseOneUploadPart(part: MetabaseUploadPart): Promise<MetabaseParsedWorkbook> {
  const { buffer, fileName, kindHint } = part;
  const lower = fileName.toLowerCase();
  const isCsvExt = lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt");

  // Prefer CSV path when content is clearly not a zip, even if extension says .xlsx
  // (common when Metabase CSV is saved/renamed as .xlsx).
  const asCsv = isCsvExt || (!looksLikeXlsxZip(buffer) && looksLikeCsvText(buffer));

  if (asCsv) {
    const rows = parseCsvToRows(buffer);
    const headerIdx = findHeaderRowIndex(rows, (cells) => cells.some((c) => c === "name"));
    const headerCells = (rows[headerIdx] ?? []).map((c) =>
      String(c ?? "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
    );
    const kind =
      kindHint ||
      inferKindFromFileName(fileName) ||
      inferKindFromHeaders(headerCells);
    if (!kind) {
      throw new Error(
        `Could not detect sheet type for "${fileName}". Use filename containing Roster, Social, or Audience, or include those headers.`
      );
    }
    return sheetPartFromKind(kind, rows);
  }

  if (!looksLikeXlsxZip(buffer)) {
    throw new Error(formatInvalidSignatureHint(buffer, fileName));
  }

  try {
    const multi = await parseXlsxMultiSheet(buffer);
    if (multi.sheets.roster || multi.sheets.social || multi.sheets.audience) {
      return multi;
    }
    // Explicit hint for single-sheet xlsx
    if (kindHint) {
      const workbook = await readXlsxFile(buffer);
      const sheetName = String(workbook[0]?.sheet ?? "Sheet1");
      const rows = (await readSheet(buffer, sheetName)) as unknown[][];
      return sheetPartFromKind(kindHint, rows);
    }
    throw new Error(
      `No Roster / Social / Audience sheets found in "${fileName}". Sheet names: ${multi.sheetNames.join(", ") || "(none)"}.`
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/invalid signature/i.test(msg)) {
      if (looksLikeCsvText(buffer)) {
        const rows = parseCsvToRows(buffer);
        const kind =
          kindHint ||
          inferKindFromFileName(fileName) ||
          inferKindFromHeaders(
            ((rows[0] ?? []) as unknown[]).map((c) =>
              String(c ?? "")
                .toLowerCase()
                .trim()
                .replace(/\s+/g, " ")
            )
          );
        if (kind) return sheetPartFromKind(kind, rows);
      }
      throw new Error(formatInvalidSignatureHint(buffer, fileName));
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}

/**
 * Parse one or more Metabase downloads into a combined workbook model.
 * Pass a single multi-sheet .xlsx, or separate CSV/XLSX files for each table.
 */
export async function parseMetabaseUploads(
  parts: MetabaseUploadPart[]
): Promise<MetabaseParsedWorkbook> {
  if (parts.length === 0) {
    throw new Error("No files provided.");
  }

  let combined = emptyParsed();
  for (const part of parts) {
    const parsed = await parseOneUploadPart(part);
    combined = mergeParsed(combined, parsed);
  }

  if (!combined.sheets.roster && !combined.sheets.social && !combined.sheets.audience) {
    throw new Error(
      'Workbook must include at least one of: Roster, Social Data / Owned Social, or Audience Data sheets (or CSV downloads of those tables).'
    );
  }

  return combined;
}

/** @deprecated Prefer parseMetabaseUploads for CSV + multi-file support. */
export async function parseMetabaseWorkbook(buffer: Buffer): Promise<MetabaseParsedWorkbook> {
  return parseMetabaseUploads([{ buffer, fileName: "workbook.xlsx" }]);
}

export function socialNameFromRow(row: Record<string, unknown>): string | null {
  return toStringOrNull(cell(row, "Name", "name", "name_raw"));
}

export function splitDisplayName(displayName: string): { first_name: string; last_name: string } {
  return splitName(displayName);
}
