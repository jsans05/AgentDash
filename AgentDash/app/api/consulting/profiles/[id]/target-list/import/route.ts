import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireConsultingProfileAccess, ConsultingAccessError } from "@/lib/consulting/access";
import {
  parseConsultingTargetListSpreadsheet,
  upsertConsultingTargetListRows,
} from "@/lib/consulting/import-target-list";
import {
  enforceContentLengthLimit,
  enforceFileSizeLimit,
  MAX_API_PAYLOAD_BYTES,
} from "@/lib/api/request-limits";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const profile = await requireNonAccounting();
  const { id: consultingProfileId } = await params;
  const supabase = await createServerClient();

  try {
    await requireConsultingProfileAccess(supabase, profile, consultingProfileId);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

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
    return NextResponse.json({ error: "Please upload an .xlsx/.xls file" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseConsultingTargetListSpreadsheet(buffer);
    if (parsed.rows.length === 0) {
      const msg =
        parsed.errors[0] ?? "No importable rows found (need Company or Brand column with data)";
      return NextResponse.json({ error: msg, errors: parsed.errors }, { status: 400 });
    }

    const supabaseAdmin = await createServiceRoleClient();
    const summary = await upsertConsultingTargetListRows(supabaseAdmin, {
      consultingProfileId,
      userId: profile.user_id,
      rows: parsed.rows,
    });

    return NextResponse.json({
      ...summary,
      parse_errors: parsed.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
