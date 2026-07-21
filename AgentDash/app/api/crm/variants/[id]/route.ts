import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import { VARIANT_LABELS } from "@/lib/crm/outreach-variants";

const CHANNELS = new Set([
  "cold_email",
  "support_email",
  "instagram_dm",
  "instagram_engage",
  "linkedin",
  "cold_call",
]);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { data: existing, error: findErr } = await supabase
    .from("outreach_variants")
    .select("*")
    .eq("id", id)
    .single();

  if (findErr || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    existing.created_by_user_id !== profile.user_id &&
    profile.role !== "admin"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    updates.name = body.name == null || String(body.name).trim() === "" ? null : String(body.name).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "subject")) {
    updates.subject =
      body.subject == null || String(body.subject).trim() === ""
        ? null
        : String(body.subject).trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "body")) {
    const t = String(body.body ?? "").trim();
    if (!t) return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
    updates.body = t;
  }
  if (Object.prototype.hasOwnProperty.call(body, "channel")) {
    const ch = String(body.channel).trim();
    if (!CHANNELS.has(ch)) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    updates.channel = ch;
  }
  if (Object.prototype.hasOwnProperty.call(body, "variant_label")) {
    const label = String(body.variant_label).trim().toUpperCase();
    if (!(VARIANT_LABELS as readonly string[]).includes(label)) {
      return NextResponse.json({ error: "Invalid variant_label" }, { status: 400 });
    }
    updates.variant_label = label;
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    updates.is_active = Boolean(body.is_active);
  }
  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    updates.archived = Boolean(body.archived);
  }
  if (Object.prototype.hasOwnProperty.call(body, "sequence_step_id")) {
    updates.sequence_step_id =
      body.sequence_step_id == null || String(body.sequence_step_id).trim() === ""
        ? null
        : String(body.sequence_step_id).trim();
  }

  const { data, error } = await supabase
    .from("outreach_variants")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, variant: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id } = await params;

  const { data: existing } = await supabase
    .from("outreach_variants")
    .select("created_by_user_id")
    .eq("id", id)
    .single();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.created_by_user_id !== profile.user_id && profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft-delete to preserve historical stats
  const { error } = await supabase
    .from("outreach_variants")
    .update({ archived: true, is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
