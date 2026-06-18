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

export async function markAthleteCategoriesCovered(
  supabase: SupabaseClientLike,
  athleteId: string,
  taxonomyIds: string[]
): Promise<void> {
  const uniqueTaxonomyIds = Array.from(
    new Set(
      (taxonomyIds ?? [])
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );

  if (uniqueTaxonomyIds.length === 0) return;

  const rows = uniqueTaxonomyIds.map((taxonomy_id) => ({
    athlete_id: athleteId,
    taxonomy_id,
  }));

  const { error } = await supabase
    .from("athlete_covered_categories")
    .upsert(rows, { onConflict: "athlete_id,taxonomy_id", ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

export async function syncCoveredCategoriesOnArchiveChange(
  supabase: SupabaseClientLike,
  athleteId: string,
  contractId: string,
  archived: boolean
): Promise<void> {
  const { data: exclusivities, error: exclError } = await supabase
    .from("contract_exclusivities")
    .select("taxonomy_id")
    .eq("contract_id", contractId);

  if (exclError) throw new Error(exclError.message);

  const taxonomyIds: string[] = (exclusivities ?? [])
    .map((row: { taxonomy_id: string }) => row.taxonomy_id)
    .filter((id: string) => id.length > 0);

  if (taxonomyIds.length === 0) return;

  if (!archived) {
    await markAthleteCategoriesCovered(supabase, athleteId, taxonomyIds);
    return;
  }

  const { data: otherContracts, error: contractsError } = await supabase
    .from("contracts")
    .select("contract_id")
    .eq("athlete_id", athleteId)
    .eq("archived", false)
    .neq("contract_id", contractId);

  if (contractsError) throw new Error(contractsError.message);

  const otherContractIds = (otherContracts ?? []).map(
    (row: { contract_id: string }) => row.contract_id
  );

  let stillClaimed = new Set<string>();
  if (otherContractIds.length > 0) {
    const { data: otherExclusivities, error: otherExclError } = await supabase
      .from("contract_exclusivities")
      .select("taxonomy_id")
      .in("contract_id", otherContractIds)
      .in("taxonomy_id", taxonomyIds);

    if (otherExclError) throw new Error(otherExclError.message);

    stillClaimed = new Set(
      (otherExclusivities ?? []).map((row: { taxonomy_id: string }) => row.taxonomy_id)
    );
  }

  const toRemove = taxonomyIds.filter((id) => !stillClaimed.has(id));
  if (toRemove.length === 0) return;

  const { error: deleteError } = await supabase
    .from("athlete_covered_categories")
    .delete()
    .eq("athlete_id", athleteId)
    .in("taxonomy_id", toRemove);

  if (deleteError) throw new Error(deleteError.message);
}
