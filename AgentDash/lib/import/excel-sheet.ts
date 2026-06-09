/** Utilities for parsing Excel sheets that may have title rows above headers. */

function normalizeCell(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function findHeaderRowIndex(
  rows: unknown[][],
  detect: (headerCells: string[]) => boolean,
  maxScan = 12
): number {
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map(normalizeCell);
    if (detect(cells)) return i;
  }
  return 0;
}

export function detectTalentInfoHeader(cells: string[]): boolean {
  return (
    cells.some((c) => c === "first name" || c.endsWith("first name")) &&
    cells.some((c) => c === "last name" || c.endsWith("last name"))
  );
}

export function detectSocialDataHeader(cells: string[]): boolean {
  return (
    cells.some((c) => c === "name") &&
    (cells.some((c) => c.includes("total followers")) ||
      cells.some((c) => c.includes("ig followers")))
  );
}

export function detectAudienceDataHeader(cells: string[]): boolean {
  return (
    cells.some((c) => c === "name") &&
    cells.some((c) => c.includes("audience category"))
  );
}

export function rowsToObjects(
  rows: unknown[][],
  headerRowIndex: number
): Record<string, unknown>[] {
  if (rows.length <= headerRowIndex) return [];
  const headers = (rows[headerRowIndex] ?? []).map((h) => String(h ?? "").trim());
  return rows.slice(headerRowIndex + 1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i];
    });
    return obj;
  });
}

export function sheetRowsToObjects(
  rows: unknown[][],
  detect: (headerCells: string[]) => boolean
): { objects: Record<string, unknown>[]; headerRowIndex: number } {
  const headerRowIndex = findHeaderRowIndex(rows, detect);
  return { objects: rowsToObjects(rows, headerRowIndex), headerRowIndex };
}

/** Parse sheets that repeat a header row per section (e.g. category title + header + rows). */
export function sheetRowsToObjectsRepeatingHeaders(
  rows: unknown[][],
  detect: (headerCells: string[]) => boolean
): { objects: Record<string, unknown>[]; rowIndexForObject: (objectIndex: number) => number } {
  const headerIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] ?? []).map(normalizeCell);
    if (detect(cells)) headerIndices.push(i);
  }

  if (headerIndices.length === 0) {
    const { objects, headerRowIndex } = sheetRowsToObjects(rows, detect);
    return {
      objects,
      rowIndexForObject: (objectIndex) => headerRowIndex + objectIndex + 2,
    };
  }

  const objects: Record<string, unknown>[] = [];
  const excelRowByObjectIndex: number[] = [];

  for (let h = 0; h < headerIndices.length; h++) {
    const headerRowIndex = headerIndices[h]!;
    const end = headerIndices[h + 1] ?? rows.length;
    const sectionRows = rows.slice(headerRowIndex, end);
    const sectionObjects = rowsToObjects(sectionRows, 0);
    for (let i = 0; i < sectionObjects.length; i++) {
      objects.push(sectionObjects[i]!);
      excelRowByObjectIndex.push(headerRowIndex + i + 2);
    }
  }

  return {
    objects,
    rowIndexForObject: (objectIndex) => excelRowByObjectIndex[objectIndex] ?? objectIndex + 2,
  };
}
