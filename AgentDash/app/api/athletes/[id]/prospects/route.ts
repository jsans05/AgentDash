import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";
import { discoverAthleteProspectsWithClaude } from "@/lib/ai/claude-prospect-discovery";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: athleteId } = await params;
  const profile = await requireProfile();
  const supabase = await createServerClient();

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  let requestBody: Record<string, unknown> = {};
  try {
    requestBody = await req.json();
  } catch {
    requestBody = {};
  }

  const requestedCategories = Array.isArray(requestBody?.requestedCategories)
    ? requestBody.requestedCategories.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const categoryHint =
    String(requestBody?.category_hint ?? requestBody?.categoryHint ?? "").trim() || null;
  const userRequestText = String(requestBody?.user_request ?? requestBody?.userRequest ?? "").trim();
  const minPerCategory = Math.max(
    1,
    Math.min(Number(requestBody?.min_per_category ?? requestBody?.minPerCategory ?? 5), 10)
  );
  const revenueRangeMin =
    (requestBody?.revenue_range as { min?: number } | undefined)?.min != null
      ? Number((requestBody.revenue_range as { min: number }).min)
      : undefined;
  const revenueRangeMax =
    (requestBody?.revenue_range as { max?: number } | undefined)?.max != null
      ? Number((requestBody.revenue_range as { max: number }).max)
      : undefined;
  const organizationLocations = Array.isArray(requestBody?.organization_locations)
    ? requestBody.organization_locations.map(String).filter(Boolean)
    : undefined;

  let discovery;
  try {
    discovery = await discoverAthleteProspectsWithClaude(supabase, {
      athleteId,
      userId: profile.user_id,
      requestedCategories,
      categoryHint,
      userRequestText,
      minPerCategory,
      revenueRangeMin,
      revenueRangeMax,
      organizationLocations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prospect discovery failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!discovery) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  const aiResponse = discovery.markdown;

  try {
    await supabase.from("prospecting_logs").insert({
      athlete_id: athleteId,
      user_id: profile.user_id,
      categories_present: discovery.existingCategories,
      categories_missing: discovery.categoriesMissing,
      companies: {
        recommended: discovery.groupedCandidates,
        blocked: discovery.blockedCompanies,
      },
      sources: discovery.sources,
      request_messages: [{ role: "user", content: userRequestText || categoryHint || "(prospect run)" }],
      response_text: aiResponse,
    });
  } catch (logError) {
    console.error("Failed to log prospecting run:", logError);
  }

  return NextResponse.json({
    athlete: discovery.athleteName,
    sport: discovery.sport,
    categoriesPresent: discovery.existingCategories,
    endemicMissing: discovery.endemicMissing,
    nonEndemicMissing: discovery.nonEndemicMissing,
    categoriesMissing: discovery.categoriesMissing,
    prioritizedCategories: discovery.prioritizedCategories,
    unmetPriorityTerms: discovery.unmetPriorityTerms,
    prospects: aiResponse,
    rows: discovery.rows,
    sources: discovery.sources,
    blockedCompanies:
      discovery.blockedCompanies.length > 0 ? discovery.blockedCompanies : undefined,
    blockedCount: discovery.blockedCompanies.length,
  });
}
