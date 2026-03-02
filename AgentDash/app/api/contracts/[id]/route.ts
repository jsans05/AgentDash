import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

type UpdateContractBody = {
  company_name?: string;
  category_taxonomy_ids?: string[];
  start_date?: string | null;
  end_date?: string | null;
  status?: "active" | "expired" | "terminated";
  notes?: string | null;
  archived?: boolean;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const body = (await req.json()) as UpdateContractBody;

  const { data: contract } = await supabase
    .from("contracts")
    .select("contract_id, athlete_id")
    .eq("contract_id", contractId)
    .single();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const athleteId = contract.athlete_id;

  if (profile.role === "agent") {
    const { data: links } = await supabase
      .from("athlete_agents")
      .select("athlete_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .limit(1);
    const { data: athlete } = await supabase
      .from("athletes")
      .select("current_agent_id")
      .eq("athlete_id", athleteId)
      .single();
    const isLinked =
      (links && links.length > 0) ||
      athlete?.current_agent_id === profile.user_id;
    if (!isLinked) {
      return NextResponse.json(
        { error: "You are not assigned to this athlete" },
        { status: 403 }
      );
    }
  }

  let companyId: string | undefined;
  const companyName = body.company_name?.trim();
  if (companyName !== undefined) {
    if (!companyName) {
      return NextResponse.json(
        { error: "Company name cannot be empty" },
        { status: 400 }
      );
    }
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
  }

  const startDate =
    body.start_date !== undefined
      ? (body.start_date?.trim() || null)
      : undefined;
  const endDate =
    body.end_date !== undefined
      ? (body.end_date?.trim() || null)
      : undefined;
  const status =
    body.status && ["active", "expired", "terminated"].includes(body.status)
      ? body.status
      : undefined;

  const updates: Record<string, unknown> = {};
  if (companyId !== undefined) updates.company_id = companyId;
  if (startDate !== undefined) updates.start_date = startDate;
  if (endDate !== undefined) updates.end_date = endDate;
  if (status !== undefined) updates.status = status;
  if (body.notes !== undefined) updates.notes = body.notes ?? null;
  if (body.archived !== undefined) updates.archived = Boolean(body.archived);

  const categoryTaxonomyIds = Array.isArray(body.category_taxonomy_ids)
    ? body.category_taxonomy_ids.filter((id) => typeof id === "string" && id.trim())
    : undefined;

  if (categoryTaxonomyIds !== undefined) {
    if (categoryTaxonomyIds.length === 0) {
      return NextResponse.json({ error: "At least one category is required." }, { status: 400 });
    }
    const { data: firstTaxonomy } = await supabase
      .from("sponsorship_taxonomies")
      .select("category")
      .eq("id", categoryTaxonomyIds[0])
      .single();
    updates.category = firstTaxonomy?.category ?? "Unknown";
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("contracts")
      .update(updates)
      .eq("contract_id", contractId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  if (categoryTaxonomyIds !== undefined) {
    await supabase.from("contract_exclusivities").delete().eq("contract_id", contractId);
    const inserts = categoryTaxonomyIds.map((taxonomyId) => ({
      contract_id: contractId,
      taxonomy_id: taxonomyId,
    }));
    const { error: exclError } = await supabase.from("contract_exclusivities").insert(inserts);
    if (exclError) {
      return NextResponse.json({ error: "Failed to update categories" }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
