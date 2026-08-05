import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNotBlockedCompanyName } from "@/lib/import/blocked-company-names";

export async function getOrCreateCompanyByName(
  supabase: SupabaseClient,
  companyName: string
): Promise<string> {
  const name = companyName.trim();
  if (!name) throw new Error("company_name required");
  assertNotBlockedCompanyName(name);

  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("company_id")
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.company_id) return existing.company_id;

  const { data: created, error: createdError } = await supabase
    .from("companies")
    .insert({ name, industry: null })
    .select("company_id")
    .single();
  if (createdError) throw new Error(createdError.message);
  return created.company_id;
}
