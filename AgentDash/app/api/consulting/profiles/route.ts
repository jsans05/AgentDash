import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireConsultingProfileAdmin, ConsultingAccessError } from "@/lib/consulting/access";

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  if (profile.role === "admin") {
    const { data, error } = await supabase
      .from("consulting_profiles")
      .select("id, name, description, created_at, updated_at")
      .order("name", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profiles: data ?? [] });
  }

  const { data: memberships, error: memErr } = await supabase
    .from("consulting_profile_members")
    .select("profile_id, consulting_profiles(id, name, description, created_at, updated_at)")
    .eq("user_id", profile.user_id);
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const profiles = (memberships ?? [])
    .map((m) => {
      const p = Array.isArray(m.consulting_profiles)
        ? m.consulting_profiles[0]
        : m.consulting_profiles;
      return p;
    })
    .filter(Boolean);

  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  const profile = await requireProfile();
  try {
    await requireConsultingProfileAdmin(profile);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const description =
    body.description != null ? String(body.description).trim() || null : null;

  const supabaseAdmin = await createServiceRoleClient();
  const { data, error } = await supabaseAdmin
    .from("consulting_profiles")
    .insert({ name, description })
    .select("id, name, description, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
