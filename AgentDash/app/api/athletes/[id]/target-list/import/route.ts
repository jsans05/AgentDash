import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  clearAthleteFromAllTargetListCards,
  importAthleteTargetListRows,
  parseAthleteTargetListSpreadsheet,
} from "@/lib/crm/import-athlete-target-list";
import {
  enforceContentLengthLimit,
  enforceFileSizeLimit,
  MAX_API_PAYLOAD_BYTES,
} from "@/lib/api/request-limits";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/athletes/:id/target-list/import
 *
 * Imports a target-list spreadsheet (.xlsx/.xls) for an athlete. With
 * `replace=1`, first unlinks the athlete from every pipeline card on the
 * shared list (all owners), archiving cards left with no athletes. Then
 * imports the file onto the caller's pipeline cards so every uploaded brand
 * is assigned to them.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const replace = ["1", "true"].includes(String(formData.get("replace") ?? "").toLowerCase());

  const fileSizeError = enforceFileSizeLimit(
    file,
    MAX_API_PAYLOAD_BYTES,
    "Uploaded file too large. Max 25 MB."
  );
  if (fileSizeError) return fileSizeError;

  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return NextResponse.json({ error: "Please upload an .xlsx/.xls file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseAthleteTargetListSpreadsheet(buffer);
    if (parsed.rows.length === 0) {
      const msg =
        parsed.errors[0] ?? "No importable rows found (need Company or Brand column with data)";
      return NextResponse.json({ error: msg, errors: parsed.errors }, { status: 400 });
    }

    const supabaseAdmin = await createServiceRoleClient();

    const { data: athleteRow, error: athleteErr } = await supabaseAdmin
      .from("athletes")
      .select("athlete_id, first_name, last_name, sport")
      .eq("athlete_id", athleteId)
      .maybeSingle();
    if (athleteErr) throw new Error(athleteErr.message);
    if (!athleteRow) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }
    const athleteName = [athleteRow.first_name, athleteRow.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    let cleared = 0;
    let cardsArchived = 0;
    if (replace) {
      const result = await clearAthleteFromAllTargetListCards(supabaseAdmin, athleteId);
      cleared = result.cleared;
      cardsArchived = result.archived;
    }

    const summary = await importAthleteTargetListRows(supabaseAdmin, {
      userId: profile.user_id,
      athlete: {
        athlete_id: athleteId,
        name: athleteName,
        sport: athleteRow.sport ?? null,
      },
      rows: parsed.rows,
    });

    return NextResponse.json({
      ...summary,
      cleared,
      cards_archived: cardsArchived,
      parse_errors: parsed.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
