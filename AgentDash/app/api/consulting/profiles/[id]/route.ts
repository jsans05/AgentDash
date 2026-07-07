import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  requireConsultingProfileAccess,
  requireConsultingProfileAdmin,
  ConsultingAccessError,
} from "@/lib/consulting/access";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  const { id } = await params;
  const supabase = await createServerClient();

  try {
    await requireConsultingProfileAccess(supabase, profile, id);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { data: consultingProfile, error } = await supabase
    .from("consulting_profiles")
    .select("id, name, description, created_at, updated_at")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: members, error: memErr } = await supabase
    .from("consulting_profile_members")
    .select("user_id, role, profiles(first_name, last_name, email, role)")
    .eq("profile_id", id);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const { data: seeds, error: seedsErr } = await supabase
    .from("consulting_profile_seeds")
    .select("id, company_id, label, companies(name, website)")
    .eq("profile_id", id)
    .order("created_at", { ascending: true });
  if (seedsErr) return NextResponse.json({ error: seedsErr.message }, { status: 500 });

  return NextResponse.json({
    profile: consultingProfile,
    members: members ?? [],
    seeds: seeds ?? [],
  });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  const { id } = await params;

  try {
    await requireConsultingProfileAdmin(profile);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const supabaseAdmin = await createServiceRoleClient();

  if (body.name != null || body.description !== undefined) {
    const patch: Record<string, unknown> = {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      patch.name = name;
    }
    if (body.description !== undefined) {
      patch.description =
        body.description == null ? null : String(body.description).trim() || null;
    }
    const { error } = await supabaseAdmin.from("consulting_profiles").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Array.isArray(body.member_user_ids)) {
    const userIds = [...new Set(body.member_user_ids.map(String).filter(Boolean))];
    await supabaseAdmin.from("consulting_profile_members").delete().eq("profile_id", id);
    if (userIds.length > 0) {
      const rows = userIds.map((user_id) => ({
        profile_id: id,
        user_id,
        role: "member" as const,
      }));
      const { error: insErr } = await supabaseAdmin.from("consulting_profile_members").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  if (Array.isArray(body.seeds)) {
    for (const seed of body.seeds) {
      if (seed.remove && seed.id) {
        await supabaseAdmin.from("consulting_profile_seeds").delete().eq("id", String(seed.id));
      }
    }
  }

  const { data: updated, error: fetchErr } = await supabaseAdmin
    .from("consulting_profiles")
    .select("id, name, description, created_at, updated_at")
    .eq("id", id)
    .single();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  return NextResponse.json({ profile: updated });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const profile = await requireNonAccounting();
  const { id } = await params;

  try {
    await requireConsultingProfileAdmin(profile);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const supabaseAdmin = await createServiceRoleClient();
  const { error } = await supabaseAdmin.from("consulting_profiles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
