import type { MetabaseSheetKind, MetabaseUploadPart } from "@/lib/import/metabase-workbook";

function kindFromFieldName(field: string): MetabaseSheetKind | null {
  const f = field.toLowerCase();
  if (f === "roster" || f === "file_roster") return "Roster";
  if (f === "social" || f === "file_social") return "Social";
  if (f === "audience" || f === "file_audience") return "Audience";
  return null;
}

/** Collect Metabase upload parts from multipart form (file | files | roster/social/audience). */
export async function metabasePartsFromFormData(
  formData: FormData
): Promise<MetabaseUploadPart[]> {
  const parts: MetabaseUploadPart[] = [];

  const single = formData.get("file");
  if (single instanceof File && single.size > 0) {
    parts.push({
      buffer: Buffer.from(await single.arrayBuffer()),
      fileName: single.name || "upload.xlsx",
      kindHint: null,
    });
  }

  for (const field of ["roster", "social", "audience", "file_roster", "file_social", "file_audience"]) {
    const f = formData.get(field);
    if (f instanceof File && f.size > 0) {
      parts.push({
        buffer: Buffer.from(await f.arrayBuffer()),
        fileName: f.name || `${field}.csv`,
        kindHint: kindFromFieldName(field),
      });
    }
  }

  const multi = formData.getAll("files");
  for (const f of multi) {
    if (f instanceof File && f.size > 0) {
      parts.push({
        buffer: Buffer.from(await f.arrayBuffer()),
        fileName: f.name || "upload.csv",
        kindHint: null,
      });
    }
  }

  // Dedupe identical buffers by fileName+size
  const seen = new Set<string>();
  const unique: MetabaseUploadPart[] = [];
  for (const p of parts) {
    const key = `${p.fileName}:${p.buffer.length}:${p.kindHint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
}
