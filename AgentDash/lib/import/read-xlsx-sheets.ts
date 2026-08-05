/**
 * Read .xlsx workbooks into sheet name + row matrices.
 * Prefers read-excel-file; falls back to ExcelJS when Metabase (and similar)
 * writes ZIP64 / data-descriptor archives that unzipper's streaming parser rejects.
 */

import ExcelJS from "exceljs";
import readXlsxFile, { readSheet } from "read-excel-file/node";

export type XlsxSheetTable = {
  name: string;
  rows: unknown[][];
};

function isZipStreamParseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid signature/i.test(msg);
}

function excelCellToPrimitive(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("result" in v) return excelCellToPrimitive(v.result);
    if ("sharedFormula" in v || "formula" in v) return excelCellToPrimitive(v.result ?? null);
  }
  return String(value);
}

async function readViaExcelJs(buffer: Buffer): Promise<XlsxSheetTable[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs Buffer typing is stricter than Node's Buffer across TS versions
  await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  return workbook.worksheets.map((sheet) => {
    const rows: unknown[][] = [];
    const colCount = Math.max(sheet.columnCount || 0, 1);
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: unknown[] = [];
      for (let c = 1; c <= Math.max(colCount, row.cellCount || 0); c++) {
        cells.push(excelCellToPrimitive(row.getCell(c).value));
      }
      // Trim trailing empties for stability with header detection
      while (cells.length > 0 && (cells[cells.length - 1] == null || cells[cells.length - 1] === "")) {
        cells.pop();
      }
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });
}

async function readViaReadExcelFile(buffer: Buffer): Promise<XlsxSheetTable[]> {
  const workbook = await readXlsxFile(buffer);
  const tables: XlsxSheetTable[] = [];
  for (const sheet of workbook) {
    const name = String(sheet.sheet ?? "");
    const rows = (await readSheet(buffer, name)) as unknown[][];
    tables.push({ name, rows });
  }
  return tables;
}

/**
 * Returns all sheets as row matrices. Throws only if both parsers fail.
 */
export async function readXlsxSheetTables(buffer: Buffer): Promise<XlsxSheetTable[]> {
  try {
    return await readViaReadExcelFile(buffer);
  } catch (e) {
    if (!isZipStreamParseError(e)) throw e;
    try {
      return await readViaExcelJs(buffer);
    } catch (fallbackErr) {
      const primary = e instanceof Error ? e.message : String(e);
      const secondary =
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(
        `Could not parse Excel workbook (ZIP stream error: ${primary}; ExcelJS: ${secondary})`
      );
    }
  }
}
