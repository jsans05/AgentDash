import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import { searchCompanies } from "@/lib/enrichment";
import { createChatCompletion } from "@/lib/ai/anthropic-chat-client";
import { ilikeContains } from "@/lib/supabase/ilike";

export async function generateCompanyDescription(
  supabase: SupabaseClient,
  profile: Profile,
  params: {
    company_name: string;
    pipeline_id?: string | null;
    save_to_pipeline?: boolean;
  }
) {
  const companyName = String(params.company_name ?? "").trim();
  if (!companyName) return { error: "company_name is required" };

  let pipelineId = params.pipeline_id?.trim() || "";
  let existingWebsite: string | null = null;
  let existingIndustry: string | null = null;

  if (pipelineId) {
    const { data: card, error } = await supabase
      .from("crm_companies_pipeline")
      .select("id, created_by_user_id, company_description, companies(name, website, industry)")
      .eq("id", pipelineId)
      .maybeSingle();
    if (error) throw error;
    if (!card) return { error: "Pipeline card not found" };
    if (
      card.created_by_user_id !== profile.user_id &&
      profile.role !== "admin" &&
      profile.role !== "sales"
    ) {
      return { error: "Forbidden" };
    }
    const company = (Array.isArray(card.companies) ? card.companies[0] : card.companies) as
      | { name?: string | null; website?: string | null; industry?: string | null }
      | null
      | undefined;
    existingWebsite = company?.website?.trim() || null;
    existingIndustry = company?.industry?.trim() || null;
  } else {
    const { data: company } = await supabase
      .from("companies")
      .select("website, industry")
      .ilike("name", ilikeContains(companyName))
      .limit(1)
      .maybeSingle();
    existingWebsite = company?.website?.trim() || null;
    existingIndustry = company?.industry?.trim() || null;
  }

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
    existingWebsite ? `Website: ${existingWebsite}` : "",
    existingIndustry ? `Industry: ${existingIndustry}` : "",
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

  const completion = await createChatCompletion({
    messages: [
      { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_completion_tokens: 250,
  });
  const description = completion.choices?.[0]?.message?.content?.trim() ?? "";
  if (!description) return { error: "AI returned no text" };

  const saveToPipeline = params.save_to_pipeline !== false && !!pipelineId;
  if (saveToPipeline) {
    const { error: upErr } = await supabase
      .from("crm_companies_pipeline")
      .update({ company_description: description })
      .eq("id", pipelineId);
    if (upErr) return { error: upErr.message };
  }

  return {
    company_name: companyName,
    company_description: description,
    saved_to_pipeline: saveToPipeline,
  };
}
