import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** GET: list agents for an athlete (admin only; page uses server data for others) */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole("admin");
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("athlete_agents")
    .select(`
      user_id,
      is_primary,
      created_at,
      profiles:user_id (first_name, last_name, email)
    `)
    .eq("athlete_id", params.id)
    .order("is_primary", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST: add an agent to an athlete (admin only) */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const user_id = body.user_id as string | undefined;
  const is_primary = Boolean(body.is_primary);

  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = await createServiceRoleClient();

  if (is_primary) {
    await supabase
      .from("athlete_agents")
      .update({ is_primary: false })
      .eq("athlete_id", params.id);
  }

  const { error } = await supabase.from("athlete_agents").insert({
    athlete_id: params.id,
    user_id,
    is_primary,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Agent already assigned to this athlete" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** PATCH: set primary agent (admin only) */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const user_id = body.user_id as string | undefined;
  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const supabase = await createServiceRoleClient();
  await supabase
    .from("athlete_agents")
    .update({ is_primary: false })
    .eq("athlete_id", params.id);

  const { error } = await supabase
    .from("athlete_agents")
    .update({ is_primary: true })
    .eq("athlete_id", params.id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE: remove an agent from an athlete (admin only) */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  await requireRole("admin");
  const url = new URL(req.url);
  const user_id = url.searchParams.get("user_id");
  if (!user_id) {
    return NextResponse.json({ error: "user_id query required" }, { status: 400 });
  }

  const supabase = await createServiceRoleClient();
  const { error } = await supabase
    .from("athlete_agents")
    .delete()
    .eq("athlete_id", params.id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
