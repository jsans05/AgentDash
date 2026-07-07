import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { searchCompanies } from "@/lib/enrichment";
import { createChatCompletion } from "@/lib/ai/anthropic-chat-client";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { id } = await params;

  const { data: card, error: cardErr } = await supabase
    .from("crm_companies_pipeline")
    .select("id, created_by_user_id, company_id, companies(name, website, industry)")
    .eq("id", id)
    .single();
  if (cardErr || !card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (card.created_by_user_id !== profile.user_id && profile.role !== "admin" && profile.role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const company = (Array.isArray(card.companies) ? card.companies[0] : card.companies) as
    | { name?: string | null; website?: string | null; industry?: string | null }
    | null
    | undefined;
  const companyName = String(company?.name ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "Company has no name" }, { status: 400 });
  }

  // Web search via Tavily / configured provider
  let webSnippets: string[] = [];
  try {
    const results = await searchCompanies(companyName);
    webSnippets = results
      .slice(0, 6)
      .map((r) => `- ${r.name}${r.website ? ` (${r.website})` : ""}: ${String(r.description ?? "").trim()}`)
      .filter(Boolean);
  } catch {
    webSnippets = [];
  }

  const existingContext = [
    company?.website ? `Website: ${company.website}` : "",
    company?.industry ? `Industry: ${company.industry}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sources = webSnippets.length > 0 ? webSnippets.join("\n") : "(no web results)";

  const systemPrompt =
    "You write concise, factual 2-3 sentence company descriptions for a sponsorship CRM. " +
    "Explain what the company does, the product category, and any notable brand positioning. " +
    "Avoid hype, marketing fluff, and speculation. If the web sources are thin, keep it short and generic. Do not invent facts.";

  const userPrompt = [
    `Company: ${companyName}`,
    existingContext ? existingContext : "",
    "",
    "Web search results:",
    sources,
    "",
    "Write a 2-3 sentence company description.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await createChatCompletion({
      messages: [
        { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_completion_tokens: 250,
    });
    const description = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (!description) {
      return NextResponse.json({ error: "AI returned no text" }, { status: 502 });
    }

    const { error: upErr } = await supabase
      .from("crm_companies_pipeline")
      .update({ company_description: description })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ company_description: description });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to generate description";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
