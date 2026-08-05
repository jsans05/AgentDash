import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { importCrmProspectRows, parseCrmProspectSpreadsheet } from "@/lib/crm/import-crm-prospect-list";
import { assertCrmListOwner } from "@/lib/crm/crm-lists-server";
import { enforceContentLengthLimit, enforceFileSizeLimit, MAX_API_PAYLOAD_BYTES } from "@/lib/api/request-limits";
type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};
export async function POST(req: Request, {
  params
}: RouteParams) {
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;
  const profile = await requireNonAccounting();
  if (profile.role === "sales") {
    return NextResponse.json({
      error: "Not allowed for sales role"
    }, {
      status: 403
    });
  }
  const {
    id: listId
  } = await params;
  const supabaseAdmin = await createServiceRoleClient();
  try {
    await assertCrmListOwner(supabaseAdmin, listId, profile.user_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List not found";
    const status = msg === "Unauthorized" ? 403 : 404;
    return NextResponse.json({
      error: msg
    }, {
      status
    });
  }
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({
      error: "No file provided"
    }, {
      status: 400
    });
  }
  const fileSizeError = enforceFileSizeLimit(file, MAX_API_PAYLOAD_BYTES, "Uploaded file too large. Max 25 MB.");
  if (fileSizeError) return fileSizeError;
  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    return NextResponse.json({
      error: "Please upload an .xlsx/.xls file"
    }, {
      status: 400
    });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseCrmProspectSpreadsheet(buffer);
    if (parsed.rows.length === 0) {
      const msg = parsed.errors[0] ?? "No importable rows found (need a Company column with data)";
      return NextResponse.json({
        error: msg,
        errors: parsed.errors
      }, {
        status: 400
      });
    }
    const summary = await importCrmProspectRows(supabaseAdmin, {
      userId: profile.user_id,
      rows: parsed.rows,
      listId
    });
    return NextResponse.json({
      ...summary,
      parse_errors: parsed.errors
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({
      error: msg
    }, {
      status: 500
    });
  }
}