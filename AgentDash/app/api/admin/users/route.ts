import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  await requireRole("admin");

  const url = new URL(req.url);
  const agentsOnly = url.searchParams.get("agents_only") === "1";

  const supabase = await createServiceRoleClient();

  if (agentsOnly) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, first_name, last_name, email")
      .eq("role", "agent")
      .order("last_name");
    return NextResponse.json(profiles ?? []);
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, role, first_name, last_name, email, created_at")
    .order("created_at", { ascending: false });

  const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  const users = (profiles || []).map((p) => {
    const authUser = authUsers?.users?.find((u) => u.id === p.user_id);
    return {
      user_id: p.user_id,
      email: p.email ?? authUser?.email ?? "",
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? "",
      role: p.role,
      created_at: p.created_at,
      last_sign_in: authUser?.last_sign_in_at ?? null,
    };
  });

  return NextResponse.json(users);
}

export async function POST(req: Request) {
  await requireRole("admin");

  const body = await req.json();
  const { email, password, first_name, last_name, role } = body;

  if (!email || !password?.trim()) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const supabase = await createServiceRoleClient();

  const { data: user, error: authError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: password.trim(),
    email_confirm: true,
    user_metadata: { first_name: first_name?.trim() ?? "", last_name: last_name?.trim() ?? "" },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const profileRole = role === "admin" || role === "sales" || role === "agent" ? role : "agent";

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: user.user.id,
    role: profileRole,
    first_name: (first_name ?? "").trim() || null,
    last_name: (last_name ?? "").trim() || null,
    email: user.user.email ?? null,
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    user_id: user.user.id,
    email: user.user.email,
  });
}
