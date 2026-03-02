import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getAudienceMetrics } from "@/lib/audience-metrics";
import OpenAI from "openai";

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
  const body = await req.json().catch(() => ({}));
  const { companyName, industry, category } = body;

  if (!companyName) {
    return NextResponse.json(
      { error: "companyName required" },
      { status: 400 }
    );
  }

  // Check access
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

  // Get athlete
  const { data: athlete } = await supabase
    .from("athletes")
    .select("*")
    .eq("athlete_id", athleteId)
    .single();

  if (!athlete) {
    return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
  }

  // Get accolades
  const accolades = athlete.accolades || [];

  const { summary: audienceSignals } = await getAudienceMetrics(supabase, athleteId);
  const hasAudience = audienceSignals.age?.length || audienceSignals.countries?.length || audienceSignals.interests?.length;

  // Get active contracts to understand gaps
  const { data: contracts } = await supabase
    .from("contracts")
    .select("category")
    .eq("athlete_id", athleteId)
    .eq("archived", false)
    .in("status", ["active"]);

  const existingCategories = (contracts || []).map((c) => c.category).filter(Boolean);

  const athleteName = `${athlete.first_name} ${athlete.last_name}`;

  const prompt = `Generate a copy-ready email pitch for ${athleteName} to ${companyName} (${industry || category || "sponsor"}).

Athlete info:
- Name: ${athleteName}
- Sport: ${athlete.sport || "Unknown"}
- Location: ${[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "Unknown"}

Accolades:
${accolades.length > 0 ? accolades.map((a) => `- ${a}`).join("\n") : "None listed"}

Audience highlights:
${hasAudience
  ? `- Age bands: ${audienceSignals.age.map((a) => `${a.label}: ${a.value}%`).join(", ")}
- Top countries: ${audienceSignals.countries.slice(0, 3).map((c) => `${c.name}: ${c.value}%`).join(", ")}
- Top interests: ${audienceSignals.interests.slice(0, 5).map((i) => `${i.name}: ${i.value}%`).join(", ")}`
  : "Not available"}

Current sponsor categories: ${existingCategories.length > 0 ? existingCategories.join(", ") : "None"}

Gap rationale: ${category ? `Athlete lacks a sponsor in the ${category} category.` : "General sponsorship opportunity."}

Generate a professional email pitch that includes:
1. Subject line
2. Opening greeting
3. Athlete accolades (2-3 key highlights)
4. Key audience metrics (bullets)
5. Why this company is a fit (gap + audience alignment)
6. Call to action
7. Closing

Format as:
Subject: [subject line]

[email body]`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a professional sports sponsorship email writer. Generate copy-ready email pitches.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
    });

    const emailDraft = completion.choices[0].message.content || "";

    return NextResponse.json({
      emailDraft,
      athlete: athleteName,
      company: companyName,
    });
  } catch (error) {
    console.error("Email generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate email" },
      { status: 500 }
    );
  }
}
