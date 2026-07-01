import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";

export class ConsultingAccessError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export async function isConsultingProfileMember(
  supabase: SupabaseClient,
  profileId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("consulting_profile_members")
    .select("user_id")
    .eq("profile_id", profileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function requireConsultingProfileAccess(
  supabase: SupabaseClient,
  profile: Profile,
  profileId: string
): Promise<void> {
  if (profile.role === "admin") return;
  const member = await isConsultingProfileMember(supabase, profileId, profile.user_id);
  if (!member) {
    throw new ConsultingAccessError("Unauthorized", 403);
  }
}

export async function requireConsultingProfileAdmin(profile: Profile): Promise<void> {
  if (profile.role !== "admin") {
    throw new ConsultingAccessError("Admin required", 403);
  }
}
