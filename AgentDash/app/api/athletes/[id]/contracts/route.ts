import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import {
  ensureAthleteAccess,
  getContractCategoryDisplay,
  markAthleteCategoriesCovered,
  resolveOrCreateCompanyId,
} from "@/lib/features/contracts/service";
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
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();

  const { id: athleteId } = await params;
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

  const access = await ensureAthleteAccess(supabase, profile, athleteId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let companyId: string;
  try {
    companyId = await resolveOrCreateCompanyId(supabase, companyName);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to resolve company";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let categoryDisplay = "Unknown";
  try {
    categoryDisplay = await getContractCategoryDisplay(supabase, categoryTaxonomyIds[0]);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to resolve category";
    return NextResponse.json({ error: message }, { status: 500 });
  }

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
    if (insertError.code === "23505") {
      return NextResponse.json(
        {
          error:
            "A contract with this company and dates already exists for this athlete.",
        },
        { status: 409 }
      );
    }
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

  try {
    await markAthleteCategoriesCovered(supabase, athleteId, categoryTaxonomyIds);
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "Failed to update athlete prospecting categories";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, contract_id: newContract?.contract_id });
}

