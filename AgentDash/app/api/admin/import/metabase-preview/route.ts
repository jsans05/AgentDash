import { requireAdminOrOperations } from "@/lib/auth";
import { enforceContentLengthLimit, enforceFileSizeLimit, MAX_API_PAYLOAD_BYTES } from "@/lib/api/request-limits";
import { metabasePartsFromFormData } from "@/lib/import/metabase-form";
import { buildMetabaseImportPreview } from "@/lib/import/metabase-preview";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    await requireAdminOrOperations();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const formData = await req.formData();
  const parts = await metabasePartsFromFormData(formData);

  if (parts.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  for (const part of parts) {
    // Approximate File wrapper for size check
    const fake = { size: part.buffer.length } as File;
    const fileSizeError = enforceFileSizeLimit(
      fake,
      MAX_API_PAYLOAD_BYTES,
      "Uploaded file too large. Max 25 MB."
    );
    if (fileSizeError) return fileSizeError;
  }

  try {
    const supabase = await createServiceRoleClient();
    const preview = await buildMetabaseImportPreview(supabase, parts);
    return NextResponse.json(preview);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preview failed" },
      { status: 400 }
    );
  }
}
