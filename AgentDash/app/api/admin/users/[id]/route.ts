import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");

  const body = await req.json();
  const { email, password, first_name, last_name, role } = body;
  const { id: userId } = await params;

  const supabase = await createServiceRoleClient();

  const updates: { email?: string; password?: string } = {};
  if (email !== undefined) updates.email = email.trim().toLowerCase();
  if (password !== undefined && String(password).trim())
    updates.password = String(password).trim();

  if (Object.keys(updates).length > 0) {
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, updates);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }
  }

  const profileUpdates: Record<string, unknown> = {};
  if (first_name !== undefined) profileUpdates.first_name = (first_name ?? "").trim() || null;
  if (last_name !== undefined) profileUpdates.last_name = (last_name ?? "").trim() || null;
  if (email !== undefined) profileUpdates.email = email.trim().toLowerCase() || null;
  if (role !== undefined && ["admin", "sales", "agent", "accounting", "operations"].includes(role)) profileUpdates.role = role;

  if (Object.keys(profileUpdates).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profileUpdates)
      .eq("user_id", userId);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("admin");

  const { id: userId } = await params;
  const supabase = await createServiceRoleClient();

  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
