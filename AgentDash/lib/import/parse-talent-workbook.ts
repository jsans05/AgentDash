import {
  detectSocialDataHeader,
  detectTalentInfoHeader,
  sheetRowsToObjects,
  sheetRowsToObjectsRepeatingHeaders,
} from "@/lib/import/excel-sheet";
import { normalizeSocialRow } from "@/lib/import/social-audience";
import { displayTalentName, normalizeTalentInfoRow } from "@/lib/import/talent-info";
import readXlsxFile, { readSheet } from "read-excel-file/node";

export type ExcelTalentRow = {
  sheet: "Talent Info";
  rowIndex: number;
  first_name: string;
  last_name: string;
  displayName: string;
  sport: string | null;
};

export type ExcelSocialNameRow = {
  sheet: "Social Data";
  rowIndex: number;
  displayName: string;
};

export type ParsedTalentWorkbook = {
  sheetNames: string[];
  talentRows: ExcelTalentRow[];
  socialNames: ExcelSocialNameRow[];
  hasTalentInfo: boolean;
};

export async function parseTalentWorkbook(buffer: Buffer): Promise<ParsedTalentWorkbook> {
  const workbook = await readXlsxFile(buffer);
  const sheetNames = workbook.map((sheet) => String(sheet.sheet ?? ""));

  const talentInfoSheetName = sheetNames.find((s) => s.trim().toLowerCase() === "talent info");
  const socialSheetName =
    sheetNames.find((s) => s.trim().toLowerCase() === "social data") ?? null;

  const talentRows: ExcelTalentRow[] = [];
  if (talentInfoSheetName) {
    const talentSheetRows = (await readSheet(buffer, talentInfoSheetName)) as unknown[][];
    const parsed = sheetRowsToObjectsRepeatingHeaders(talentSheetRows, detectTalentInfoHeader);
    for (let i = 0; i < parsed.objects.length; i++) {
      const normalized = normalizeTalentInfoRow(parsed.objects[i] as Record<string, unknown>);
      if (!normalized) continue;
      talentRows.push({
        sheet: "Talent Info",
        rowIndex: parsed.rowIndexForObject(i),
        first_name: normalized.first_name,
        last_name: normalized.last_name,
        displayName: displayTalentName(normalized),
        sport: normalized.sport,
      });
    }
  }

  const socialNames: ExcelSocialNameRow[] = [];
  if (socialSheetName) {
    const socialSheetRows = (await readSheet(buffer, socialSheetName)) as unknown[][];
    const { objects, headerRowIndex } = sheetRowsToObjects(socialSheetRows, detectSocialDataHeader);
    const seen = new Set<string>();
    for (let i = 0; i < objects.length; i++) {
      const parsed = normalizeSocialRow(objects[i] as Record<string, unknown>);
      const name = parsed.name_raw?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      socialNames.push({
        sheet: "Social Data",
        rowIndex: headerRowIndex + i + 2,
        displayName: name,
      });
    }
  }

  return {
    sheetNames,
    talentRows,
    socialNames,
    hasTalentInfo: Boolean(talentInfoSheetName),
  };
}
