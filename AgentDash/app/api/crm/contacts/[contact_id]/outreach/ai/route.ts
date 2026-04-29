import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { audiencePercentPoints, getAthleteAudienceProfile } from "@/lib/athlete-data";
import { getRelevantAudienceInterests } from "@/lib/ai/getRelevantAudienceInterests";
import { validateOutreachNotes } from "@/lib/ai/output-validation";
import { OPENAI_CHAT_MODEL, OPENAI_REASONING_EFFORT } from "@/lib/ai/openai-chat-defaults";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ contact_id: string }> }
) {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { contact_id } = await params;
  const body = await req.json().catch(() => ({}));

  const outreach_channel =
    body.outreach_channel != null && String(body.outreach_channel).trim()
      ? String(body.outreach_channel).trim()
      : "other";

  const athlete_id =
    body.athlete_id != null && String(body.athlete_id).trim() ? String(body.athlete_id) : null;

  const { data: contact, error: contactError } = await supabase
    .from("crm_contacts")
    .select(
      `
        *,
        companies(name),
        sponsorship_taxonomies:taxonomy_id (sport, tier, category)
      `
    )
    .eq("contact_id", contact_id)
    .single();

  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  const targetIndustryOrCategory = contact.category || (contact.sponsorship_taxonomies as any)?.category || null;

  let athleteName: string | null = null;
  let athleteContext: string = "";
  let audienceSection: string = "Audience signals: Not available.";

  if (athlete_id) {
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("athlete_id, first_name, last_name, sport, city, state, country, accolades")
      .eq("athlete_id", athlete_id)
      .single();

    if (athleteError) return NextResponse.json({ error: athleteError.message }, { status: 500 });

    if (!athlete) {
      return NextResponse.json({ error: "Athlete not found (or not accessible)" }, { status: 404 });
    }

    athleteName = `${athlete.first_name} ${athlete.last_name}`.trim();
    const location = [athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ");
    const accolades = Array.isArray(athlete.accolades) ? athlete.accolades.slice(0, 3) : [];

    athleteContext = `Athlete: ${athleteName}\nSport: ${athlete.sport || "Unknown"}\nLocation: ${
      location || "Unknown"
    }\nAccolades: ${accolades.length ? accolades.join("; ") : "None listed"}`;

    const audience = await getAthleteAudienceProfile(supabase, athlete_id);
    if (audience) {
      const ageBands = (audience.age ?? [])
        .slice(0, 3)
        .map((a) => `${a.audience_name} (${audiencePercentPoints(a.ig_audience_percent).toFixed(1)}%)`);
      const topCountries = (audience.countries ?? [])
        .slice(0, 3)
        .map((c) => `${c.audience_name} (${audiencePercentPoints(c.ig_audience_percent).toFixed(1)}%)`);
      const relevantInterestsDebug = getRelevantAudienceInterests(
        targetIndustryOrCategory,
        (audience.interests ?? []).map((i) => ({
          name: i.audience_name,
          value: Number(audiencePercentPoints(i.ig_audience_percent).toFixed(1)),
        })),
        { maxUsedInterests: 3, debugLog: process.env.NODE_ENV !== "production" }
      );
      const usedInterests = relevantInterestsDebug.usedInterests;
      const interestStrengthLabel =
        relevantInterestsDebug.interestStrength.maxInterestPct != null &&
        relevantInterestsDebug.interestStrength.maxInterestPct >= 6
          ? "strong"
          : "weak";

      const topInterests = usedInterests.slice(0, 3).map((i) => `${i.name} (${i.value}%)`);

      audienceSection = `Audience signals:\n- Age: ${ageBands.length ? ageBands.join("; ") : "Not available"}\n- Countries: ${
        topCountries.length ? topCountries.join("; ") : "Not available"
      }\n- Interests: ${topInterests.length ? topInterests.join("; ") : "Not available"}\n- Interest alignment: ${interestStrengthLabel}`;
    }
  }

  const prompt = `You are a professional sports sponsorship outreach writer.\n\nWrite concise outreach notes for the following contact.\n\nContact:\n- Name: ${contact.first_name} ${contact.last_name}\n- Role: ${contact.role || "N/A"}\n- Company: ${contact.companies?.name || "Unknown"}\n\nCRM lane:\n- Category: ${contact.category || contact.sponsorship_taxonomies?.category || "N/A"}\n- Product description: ${contact.product_description || "N/A"}\n\n${athleteContext ? athleteContext : "No specific athlete context provided; write generic but still relevant outreach."}\n\n${audienceSection}\n\nChannel: ${outreach_channel}\n\nTask:\n- Produce outreach_notes in plain text.\n- Keep it under 120 words.\n- Include: (1) why this company is a fit for this lane, (2) what you’re proposing, (3) a clear next step question.\n- Important: Only mention audience interests that appear under "Audience signals" -> "- Interests: ..." Do not invent or mention other interest categories.\n- If interest alignment is weak, avoid overstating audience interest; lean more on sport/demo/location/accolades.\n`;

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      reasoning_effort: OPENAI_REASONING_EFFORT,
      messages: [
        { role: "system", content: "You write crisp sponsorship outreach notes suitable for copying into an email or CRM." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const outreach_notes = completion.choices[0]?.message?.content || "";
    const validation = validateOutreachNotes(outreach_notes);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error ?? "Generated outreach note failed validation." },
        { status: 422 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("crm_outreach_logs")
      .insert({
        contact_id,
        athlete_id,
        user_id: profile.user_id,
        outreach_channel,
        outreach_notes,
      })
      .select("*")
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ ok: true, log: inserted });
  } catch (error: any) {
    console.error("CRM outreach AI error:", error);
    return NextResponse.json({ error: "Failed to generate outreach notes" }, { status: 500 });
  }
}

