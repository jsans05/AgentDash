import type { SupabaseClient } from "@supabase/supabase-js";

/** Admins can view and enrich contacts on brands assigned to teammates. */
export function canManageAssignedCrmRows(role: string): boolean {
  return role === "admin";
}

/**
 * Who to persist new/found contacts as. Admins may write onto a teammate's
 * pipeline card; everyone else always writes as themselves.
 */
export async function resolveCrmWriteOwnerUserId(
  supabaseAdmin: SupabaseClient,
  profile: { user_id: string; role: string },
  companyId: string,
  requestedOwnerUserId: string | null | undefined
): Promise<string> {
  const requested = String(requestedOwnerUserId ?? "").trim();
  if (!requested || requested === profile.user_id) return profile.user_id;
  if (!canManageAssignedCrmRows(profile.role)) return profile.user_id;

  const { data, error } = await supabaseAdmin
    .from("crm_companies_pipeline")
    .select("id")
    .eq("company_id", companyId)
    .eq("created_by_user_id", requested)
    .eq("archived", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("That teammate does not own this brand");
  }
  return requested;
}
