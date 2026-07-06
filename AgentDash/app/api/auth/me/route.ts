import { NextResponse } from "next/server";
import { getProfileForUserId } from "@/lib/auth";
import { validateServerSession } from "@/lib/auth-session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAnyConsultingProfileMember } from "@/lib/consulting/access";

/**
 * Returns the current user's profile using the same server-side lookup as
 * `requireProfile` / admin routes (service role), so the client nav can trust
 * `role` without relying on browser Supabase + RLS for `profiles`.
 */
export async function GET() {
  const validation = await validateServerSession();
  if (!validation.user) {
    return NextResponse.json({ user: null, profile: null }, { status: 401 });
  }

  const profile = await getProfileForUserId(validation.user.id);
  let isConsultingUser = false;
  if (profile) {
    const supabase = await createServiceRoleClient();
    isConsultingUser = await isAnyConsultingProfileMember(supabase, profile.user_id);
  }
  return NextResponse.json({
    user: { id: validation.user.id, email: validation.user.email ?? null },
    profile,
    is_consulting_user: isConsultingUser,
  });
}
