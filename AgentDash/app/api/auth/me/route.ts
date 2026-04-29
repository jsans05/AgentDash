import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentProfile } from "@/lib/auth";

/**
 * Returns the current user's profile using the same server-side lookup as
 * `requireProfile` / admin routes (service role), so the client nav can trust
 * `role` without relying on browser Supabase + RLS for `profiles`.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null, profile: null }, { status: 401 });
  }

  const profile = await getCurrentProfile();
  return NextResponse.json({
    user: { id: user.id, email: user.email ?? null },
    profile,
  });
}
