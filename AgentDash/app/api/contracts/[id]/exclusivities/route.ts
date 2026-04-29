import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * GET /api/contracts/[id]/exclusivities
 * Get all exclusivity taxonomy nodes for a contract.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const { id: contractId } = await params;
  const supabase = await createServerClient();

  // Check contract access
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

  const { data: exclusivities, error } = await supabase
    .from("contract_exclusivities")
    .select(`
      id,
      taxonomy_id,
      sponsorship_taxonomies:taxonomy_id (
        id,
        sport,
        tier,
        category,
        sort_order
      )
    `)
    .eq("contract_id", contractId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(exclusivities ?? []);
}

/**
 * POST /api/contracts/[id]/exclusivities
 * Add an exclusivity taxonomy node to a contract.
 * Body: { taxonomy_id: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const { id: contractId } = await params;
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));
  const taxonomyId = body.taxonomy_id?.trim();

  if (!taxonomyId) {
    return NextResponse.json({ error: "taxonomy_id required" }, { status: 400 });
  }

  // Check contract access
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

  // Verify taxonomy exists
  const { data: taxonomy } = await supabase
    .from("sponsorship_taxonomies")
    .select("id")
    .eq("id", taxonomyId)
    .eq("is_active", true)
    .single();

  if (!taxonomy) {
    return NextResponse.json({ error: "Taxonomy node not found or inactive" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contract_exclusivities")
    .insert({ contract_id: contractId, taxonomy_id: taxonomyId })
    .select(`
      id,
      taxonomy_id,
      sponsorship_taxonomies:taxonomy_id (
        id,
        sport,
        tier,
        category,
        sort_order
      )
    `)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This exclusivity is already set for this contract" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * DELETE /api/contracts/[id]/exclusivities/[exclusivityId]
 * Remove an exclusivity from a contract.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await requireProfile();
  const { id: contractId } = await params;
  const supabase = await createServerClient();
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const exclusivityId =
    (typeof body?.exclusivityId === "string" && body.exclusivityId.trim()) ||
    (typeof body?.id === "string" && body.id.trim()) ||
    url.searchParams.get("exclusivityId") ||
    url.searchParams.get("id") ||
    "";

  if (!exclusivityId) {
    return NextResponse.json({ error: "exclusivityId required" }, { status: 400 });
  }

  // Check contract access
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

  const { error } = await supabase
    .from("contract_exclusivities")
    .delete()
    .eq("id", exclusivityId)
    .eq("contract_id", contractId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
