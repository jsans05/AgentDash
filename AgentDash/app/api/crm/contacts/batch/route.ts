import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { NextResponse } from "next/server";

const MAX_BATCH_SIZE = 50;

function parseContactIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { contact_ids?: unknown }).contact_ids;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_BATCH_SIZE) return null;
  return ids;
}

export async function DELETE(req: Request) {
  await requireNonAccounting();
  const supabase = await createServerClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const contactIds = parseContactIds(body);
  if (!contactIds) {
    return NextResponse.json(
      { error: `contact_ids must be a non-empty array of at most ${MAX_BATCH_SIZE} ids` },
      { status: 400 }
    );
  }

  const { data: deleted, error } = await supabase
    .from("crm_contacts")
    .delete()
    .in("contact_id", contactIds)
    .select("contact_id");

  if (error) return internalServerError(error, "crm-contacts:batch-delete");

  const deletedIds = (deleted ?? []).map((r) => String(r.contact_id));
  return NextResponse.json({ ok: true, deleted: deletedIds });
}
