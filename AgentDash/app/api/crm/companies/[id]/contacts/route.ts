import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { internalServerError } from "@/lib/api/http-errors";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id: companyId } = await params;

  const { data, error } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, first_name, last_name, role, email, phone, notes, linkedin_url, apollo_person_id, apollo_reveal_status"
    )
    .eq("company_id", companyId)
    .eq("created_by_user_id", profile.user_id)
    .eq("archived", false)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) return internalServerError(error, "crm-company-contacts:get");

  return NextResponse.json({ contacts: data ?? [] });
}
