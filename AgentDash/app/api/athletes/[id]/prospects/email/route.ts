import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";
import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { getRelevantAudienceInterests } from "@/lib/ai/getRelevantAudienceInterests";
import { validateEmailDraft } from "@/lib/ai/output-validation";
import { normalizeSportForPitch } from "@/lib/ai/email-generation";
import { curatePitchInterests } from "@/lib/ai/pitch-interest-curation";
import { composePitchEmail } from "@/lib/ai/pitch-composer";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: athleteId } = await params;
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const body = await req.json().catch(() => ({}));
  const { companyName, industry, category, pipeline_id } = body;
  const targetIndustryOrCategory = category || industry || null;

  if (!companyName) {
    return NextResponse.json(
      { error: "companyName required" },
      { status: 400 }
    );
  }

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

  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  const accolades: string[] = Array.isArray(athlete.accolades) ? athlete.accolades.map((a: any) => String(a)) : [];

  const audienceSignals = await getAthleteAudienceProfile(supabase, athleteId);
  const relevantInterestsDebug = getRelevantAudienceInterests(targetIndustryOrCategory, (audienceSignals.interests ?? []).map((i) => ({
    name: i.audience_name,
    value: Number(audiencePercentPoints(i.ig_audience_percent).toFixed(1)),
  })), {
    maxUsedInterests: 3,
    debugLog: process.env.NODE_ENV !== "production",
  });

  const athleteName = `${athlete.first_name} ${athlete.last_name}`;
  const pitchSport = normalizeSportForPitch(athlete.sport);

  let companyResearch: {
    past_partnerships: string | null;
    company_description: string | null;
    personal_notes: string | null;
  } = {
    past_partnerships: null,
    company_description: null,
    personal_notes: null,
  };

  if (pipeline_id) {
    const { data: pipelineRow } = await supabase
      .from("crm_companies_pipeline")
      .select("past_partnerships, company_description, personal_notes")
      .eq("id", String(pipeline_id))
      .eq("created_by_user_id", profile.user_id)
      .maybeSingle();
    if (pipelineRow) {
      companyResearch = {
        past_partnerships: pipelineRow.past_partnerships ?? null,
        company_description: pipelineRow.company_description ?? null,
        personal_notes: pipelineRow.personal_notes ?? null,
      };
    }
  }

  try {
    const curation = await curatePitchInterests({
      supabase,
      profile,
      pitch_type: "single_athlete",
      company_name: companyName,
      target_industry_or_category: targetIndustryOrCategory,
      athlete_id: athleteId,
    });

    const interest_names =
      curation.suggested_interests.length > 0
        ? curation.suggested_interests.map((s) => s.interest_name)
        : relevantInterestsDebug.usedInterests.map((i) => i.name);

    const composed = await composePitchEmail({
      supabase,
      profile,
      pitch_type: "single_athlete",
      company_name: companyName,
      interest_names: interest_names.length ? interest_names : curation.mapped_valid_categories.slice(0, 3),
      recipient_name: "Partnership Team",
      athlete_id: athleteId,
      target_industry_or_category: targetIndustryOrCategory,
      past_partnerships: companyResearch.past_partnerships,
      company_description: companyResearch.company_description,
      personal_notes: companyResearch.personal_notes,
    });

    const emailDraft = composed.body_markdown;
    const validation = validateEmailDraft(emailDraft);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error ?? "Generated email draft failed validation." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      emailDraft,
      athlete: athleteName,
      company: companyName,
      used_interests: composed.used_interests,
      curation_rationale: composed.curation_rationale,
      debug: {
        targetIndustryOrCategory,
        industryKey: relevantInterestsDebug.industryKey,
        mappedValidCategories: relevantInterestsDebug.mappedValidCategories,
        usedInterests: relevantInterestsDebug.usedInterests,
        excludedInterests: relevantInterestsDebug.excludedInterests,
        interestStrength: relevantInterestsDebug.interestStrength,
        athlete_sport_pitch: pitchSport,
        accolades_count: accolades.length,
      },
    });
  } catch (error) {
    console.error("Email generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate email" },
      { status: 500 }
    );
  }
}
