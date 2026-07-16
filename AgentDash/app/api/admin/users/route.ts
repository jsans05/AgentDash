import { requireRole } from "@/lib/auth";
import { apiErrorResponse, internalServerError } from "@/lib/api/http-errors";
import { enforceContentLengthLimit } from "@/lib/api/request-limits";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const createUserSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(128),
    first_name: z.string().trim().max(80).optional().default(""),
    last_name: z.string().trim().max(80).optional().default(""),
    role: z.enum(["admin", "sales", "agent", "accounting", "operations"]).optional().default("agent"),
  })
  .strict();

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
  const contentLengthError = enforceContentLengthLimit(req);
  if (contentLengthError) return contentLengthError;

  const rawBody = await req.json().catch(() => null);
  const parsedBody = createUserSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsedBody.error.flatten() },
      { status: 400 }
    );
  }
  const { email, password, first_name, last_name, role } = parsedBody.data;

  const supabase = await createServiceRoleClient();

  const { data: user, error: authError } = await supabase.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: password.trim(),
    email_confirm: true,
    user_metadata: { first_name: first_name?.trim() ?? "", last_name: last_name?.trim() ?? "" },
  });

  if (authError) {
    return apiErrorResponse({
      status: 400,
      publicMessage: "Failed to create auth user",
      cause: authError,
      context: "admin-users:post:create-auth-user",
    });
  }
  const profileRole = role;

  const { error: profileError } = await supabase.from("profiles").insert({
    user_id: user.user.id,
    role: profileRole,
    first_name: (first_name ?? "").trim() || null,
    last_name: (last_name ?? "").trim() || null,
    email: user.user.email ?? null,
  });

  if (profileError) {
    return internalServerError(profileError, "admin-users:post:create-profile");
  }

  return NextResponse.json({
    success: true,
    user_id: user.user.id,
    email: user.user.email,
  });
}
