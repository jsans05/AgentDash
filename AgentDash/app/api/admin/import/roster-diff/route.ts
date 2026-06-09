import { requireRole } from "@/lib/auth";
import { enforceContentLengthLimit, enforceFileSizeLimit, MAX_API_PAYLOAD_BYTES } from "@/lib/api/request-limits";
import { AthleteRosterCache } from "@/lib/import/athlete-roster-cache";
import { parseTalentWorkbook } from "@/lib/import/parse-talent-workbook";
import { compareRosterToWorkbook } from "@/lib/import/roster-excel-diff";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    await requireRole("admin");
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const fileSizeError = enforceFileSizeLimit(
    file,
    MAX_API_PAYLOAD_BYTES,
    "Uploaded file too large. Max 25 MB."
  );
  if (fileSizeError) return fileSizeError;

  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return NextResponse.json(
      { error: "Roster compare requires an .xlsx workbook (Talent Info and/or Social Data sheets)." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = await parseTalentWorkbook(buffer);

  if (!workbook.hasTalentInfo && workbook.socialNames.length === 0) {
    return NextResponse.json(
      {
        error:
          'Workbook must include a "Talent Info" sheet and/or a "Social Data" sheet with Name column.',
      },
      { status: 400 }
    );
  }

  const supabase = await createServiceRoleClient();
  const [rosterCache, rosterRes] = await Promise.all([
    AthleteRosterCache.load(supabase),
    supabase
      .from("athletes")
      .select("athlete_id, first_name, last_name, sport, country")
      .order("last_name")
      .order("first_name"),
  ]);

  if (rosterRes.error) {
    return NextResponse.json({ error: rosterRes.error.message }, { status: 500 });
  }

  const diff = compareRosterToWorkbook(
    rosterRes.data ?? [],
    rosterCache,
    workbook.talentRows,
    workbook.socialNames
  );

  return NextResponse.json({
    ...diff,
    sheetNames: workbook.sheetNames,
    summary: {
      rosterCount: diff.rosterCount,
      excelRowsCompared:
        diff.compareSource === "talent_info"
          ? diff.excelTalentRowCount
          : diff.excelSocialUniqueNames,
      matchedOnRoster: diff.matchedPairs,
      onlyOnRosterCount: diff.onlyOnRoster.length,
      onlyInExcelCount: diff.onlyInExcel.length,
      ambiguousExcelCount: diff.ambiguousExcel.length,
    },
  });
}
