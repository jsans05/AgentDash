import { createServerClient, createServiceRoleClient } from "./supabase/server";
import { redirect } from "next/navigation";
import type { Profile } from "./supabase/types";

export async function getCurrentUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // Use service-role client for profiles to avoid RLS-related 406s on /rest/v1/profiles
  // and ensure the logged-in user can always read their own profile on the server.
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (error) {
    console.error("[auth] getCurrentProfile error", error);
    return null;
  }
  return data;
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

export async function requireRole(role: "admin" | "sales" | "agent") {
  const profile = await requireProfile();
  if (profile.role !== role && profile.role !== "admin") {
    redirect("/unauthorized");
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
