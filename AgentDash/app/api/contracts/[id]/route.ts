import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  ensureAthleteAccess,
  getContractCategoryDisplay,
  markAthleteCategoriesCovered,
  resolveOrCreateCompanyId,
} from "@/lib/features/contracts/service";
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

  const access = await ensureAthleteAccess(supabase, profile, athleteId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
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
    try {
      companyId = await resolveOrCreateCompanyId(supabase, companyName);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to resolve company";
      return NextResponse.json({ error: message }, { status: 500 });
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
    try {
      updates.category = await getContractCategoryDisplay(supabase, categoryTaxonomyIds[0]);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to resolve category";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("contracts")
      .update(updates)
      .eq("contract_id", contractId);

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Another contract with this company and dates already exists for this athlete.",
          },
          { status: 409 }
        );
      }
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

    try {
      await markAthleteCategoriesCovered(supabase, athleteId, categoryTaxonomyIds);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Failed to update athlete prospecting categories";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
