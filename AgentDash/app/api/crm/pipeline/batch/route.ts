import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_BATCH_SIZE = 50;

function parsePipelineIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { pipeline_ids?: unknown }).pipeline_ids;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_BATCH_SIZE) return null;
  return ids;
}

export async function DELETE(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pipelineIds = parsePipelineIds(body);
  if (!pipelineIds) {
    return NextResponse.json(
      { error: `pipeline_ids must be a non-empty array of at most ${MAX_BATCH_SIZE} ids` },
      { status: 400 }
    );
  }

  const { data: archived, error } = await supabase
    .from("crm_companies_pipeline")
    .update({ archived: true })
    .in("id", pipelineIds)
    .eq("created_by_user_id", profile.user_id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const deletedIds = (archived ?? []).map((row) => String(row.id));
  return NextResponse.json({ ok: true, deleted: deletedIds });
}
