import { createServiceRoleClient } from "./supabase/server";
import { redirect } from "next/navigation";
import type { Profile, AppRole } from "./supabase/types";
import { validateServerSession } from "./auth-session";
import { isAnyConsultingProfileMember } from "./consulting/access";

export async function getCurrentUser() {
  const validation = await validateServerSession();
  return validation.user;
}

export async function getProfileForUserId(userId: string): Promise<Profile | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, role, first_name, last_name, email, created_at")
    .eq("user_id", userId)
    .single();
  if (error) {
    console.error("[auth] getProfileForUserId error", error);
    return null;
  }
  return data;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return getProfileForUserId(user.id);
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireRole(role: AppRole) {
  const profile = await requireProfile();
  if (profile.role !== role && profile.role !== "admin") {
    redirect("/unauthorized");
  }
  return profile;
}

export async function requireNonAccounting(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role === "accounting") {
    redirect("/roster");
  }
  return profile;
}

export async function requireAdminOrSales() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "sales") {
    redirect("/unauthorized");
  }
  return profile;
}

export async function requireMarketIntelAccess() {
  const profile = await requireProfile();
  if (profile.role === "admin" || profile.role === "sales") {
    return profile;
  }
  const supabase = await createServiceRoleClient();
  const isConsultingUser = await isAnyConsultingProfileMember(supabase, profile.user_id);
  if (!isConsultingUser) {
    redirect("/unauthorized");
  }
  return profile;
}
