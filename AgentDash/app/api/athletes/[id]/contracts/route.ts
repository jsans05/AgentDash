import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

type NewContractBody = {
  company_name: string;
  category_taxonomy_ids: string[]; // Categories (and exclusivity). At least one required.
  start_date?: string | null;
  end_date?: string | null;
  status?: "active" | "expired" | "terminated";
  notes?: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const athleteId = params.id;
  const body = (await req.json()) as NewContractBody;

  const companyName = body.company_name?.trim();
  if (!companyName) {
    return NextResponse.json(
      { error: "Company name is required" },
      { status: 400 }
    );
  }

  const categoryTaxonomyIds = Array.isArray(body.category_taxonomy_ids)
    ? body.category_taxonomy_ids.filter((id) => typeof id === "string" && id.trim())
    : [];
  if (categoryTaxonomyIds.length === 0) {
    return NextResponse.json(
      { error: "At least one category is required." },
      { status: 400 }
    );
  }

  const startDate = body.start_date?.trim() || null;
  const endDate = body.end_date?.trim() || null;
  const status =
    body.status && ["active", "expired", "terminated"].includes(body.status)
      ? body.status
      : "active";

  // Basic access check
  const { data: athlete } = await supabase
    .from("athletes")
    .select("athlete_id, current_agent_id")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  if (profile.role === "agent") {
    const { data: links } = await supabase
      .from("athlete_agents")
      .select("athlete_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .limit(1);
    const isLinked =
      (links && links.length > 0) || athlete.current_agent_id === profile.user_id;
    if (!isLinked) {
      return NextResponse.json(
        { error: "You are not assigned to this athlete" },
        { status: 403 }
      );
    }
  }

  // Get or create company
  let companyId: string;
  const { data: existingCompany } = await supabase
    .from("companies")
    .select("company_id")
    .eq("name", companyName)
    .maybeSingle();

  if (existingCompany) {
    companyId = existingCompany.company_id;
  } else {
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({ name: companyName, industry: null })
      .select("company_id")
      .single();
    if (companyError || !newCompany) {
      return NextResponse.json(
        { error: companyError?.message || "Failed to create company" },
        { status: 500 }
      );
    }
    companyId = newCompany.company_id;
  }

  // First category name for contracts.category (display)
  const { data: firstTaxonomy } = await supabase
    .from("sponsorship_taxonomies")
    .select("category")
    .eq("id", categoryTaxonomyIds[0])
    .single();
  const categoryDisplay = firstTaxonomy?.category ?? "Unknown";

  const { data: newContract, error: insertError } = await supabase
    .from("contracts")
    .insert({
      athlete_id: athleteId,
      company_id: companyId,
      category: categoryDisplay,
      start_date: startDate,
      end_date: endDate || null,
      status,
      notes: body.notes ?? null,
      created_by_user_id: profile.user_id,
    })
    .select("contract_id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const exclusivityInserts = categoryTaxonomyIds.map((taxonomyId: string) => ({
    contract_id: newContract!.contract_id,
    taxonomy_id: taxonomyId,
  }));
  const { error: exclError } = await supabase
    .from("contract_exclusivities")
    .insert(exclusivityInserts);

  if (exclError) {
    console.error("Failed to create contract categories:", exclError);
    return NextResponse.json({ error: "Failed to save categories" }, { status: 500 });
  }

  return NextResponse.json({ success: true, contract_id: newContract?.contract_id });
}

