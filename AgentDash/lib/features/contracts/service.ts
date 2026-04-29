type SupabaseClientLike = {
  from: (table: string) => any;
};

type UserProfileLike = {
  role: string;
  user_id: string;
};

export async function ensureAthleteAccess(
  supabase: SupabaseClientLike,
  profile: UserProfileLike,
  athleteId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: athlete, error } = await supabase
    .from("athletes")
    .select("athlete_id, current_agent_id")
    .eq("athlete_id", athleteId)
    .single();

  if (error || !athlete) {
    return { ok: false, status: 404, error: "Athlete not found" };
  }

  if (profile.role !== "agent") return { ok: true };

  const { data: links } = await supabase
    .from("athlete_agents")
    .select("athlete_id")
    .eq("athlete_id", athleteId)
    .eq("user_id", profile.user_id)
    .limit(1);

  const isLinked = (links && links.length > 0) || athlete.current_agent_id === profile.user_id;
  if (!isLinked) {
    return { ok: false, status: 403, error: "You are not assigned to this athlete" };
  }
  return { ok: true };
}

export async function resolveOrCreateCompanyId(supabase: SupabaseClientLike, companyName: string): Promise<string> {
  const trimmed = String(companyName ?? "").trim();
  if (!trimmed) throw new Error("Company name is required");

  const { data: existingCompany, error: existingError } = await supabase
    .from("companies")
    .select("company_id")
    .eq("name", trimmed)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existingCompany?.company_id) return existingCompany.company_id;

  const { data: newCompany, error: companyError } = await supabase
    .from("companies")
    .insert({ name: trimmed, industry: null })
    .select("company_id")
    .single();
  if (companyError || !newCompany) {
    throw new Error(companyError?.message || "Failed to create company");
  }
  return newCompany.company_id;
}

export async function getContractCategoryDisplay(
  supabase: SupabaseClientLike,
  taxonomyId: string
): Promise<string> {
  const { data: taxonomy, error } = await supabase
    .from("sponsorship_taxonomies")
    .select("category")
    .eq("id", taxonomyId)
    .single();
  if (error) throw new Error(error.message);
  return taxonomy?.category ?? "Unknown";
}
