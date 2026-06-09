import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";
import { formatAthleteGender } from "@/lib/athletes/gender";
import { discoverAthleteProspects } from "@/lib/ai/athlete-prospect-discovery";
import { PROSPECTING_TABLE_HEADER } from "@/lib/ai/grouped-prospecting";
import OpenAI from "openai";
import { validateGroupedProspectingOutput } from "@/lib/ai/output-validation";
import { OPENAI_CHAT_MODEL, OPENAI_REASONING_EFFORT } from "@/lib/ai/openai-chat-defaults";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

  const discovery = await discoverAthleteProspects(supabase, {
    athleteId,
    requestedCategories,
    categoryHint,
    userRequestText,
    minPerCategory,
    revenueRangeMin,
    revenueRangeMax,
    organizationLocations,
  });

  if (!discovery) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  const { data: athlete } = await supabase
    .from("athletes")
    .select("first_name, last_name, sport, gender, city, state, country, notes")
    .eq("athlete_id", athleteId)
    .single();

  let aiResponse = discovery.markdown;

  const polishPrompt = `You are a sports sponsorship prospecting assistant. Polish ONLY the Partnership Justification column wording in the markdown below. Do NOT change company names, match scores, websites, category headers, or row order.

Athlete: ${discovery.athleteName}
Sport: ${athlete?.sport || "Unknown"}
Gender: ${formatAthleteGender(athlete?.gender as Parameters<typeof formatAthleteGender>[0]) ?? "Unknown"}

Rules:
- Keep "## <Category>" headers unchanged.
- Table must use EXACT header: ${PROSPECTING_TABLE_HEADER}
- Each Partnership Justification must cite: user request, interest match, brand affinity match, and/or demographic fit.
- If a category has fewer than ${minPerCategory} rows, keep any italicized shortage note.
- Return only the grouped markdown sections.

Markdown to polish:
${discovery.markdown}`;

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      reasoning_effort: OPENAI_REASONING_EFFORT,
      messages: [
        {
          role: "system",
          content:
            "You polish partnership justification copy in sponsorship prospecting tables. Never alter scores, websites, or company names.",
        },
        { role: "user", content: polishPrompt },
      ],
      temperature: 0.5,
    });

    const polished = completion.choices[0].message.content || "";
    const validation = validateGroupedProspectingOutput(polished);
    if (validation.ok) {
      aiResponse = polished;
    }
  } catch (error) {
    console.error("AI prospecting polish error:", error);
  }

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
      request_messages: [{ role: "user", content: polishPrompt }],
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
