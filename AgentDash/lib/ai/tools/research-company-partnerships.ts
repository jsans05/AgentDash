import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/supabase/types";
import {
  companyWebsiteHintFromParts,
  isAcceptablePartnershipMarkdown,
  runPartnershipResearch,
} from "@/lib/ai/partnership-research-engine";

function mergeResearchBlock(existing: string | null, block: string): string {
  const b = block.trim();
  const e = (existing ?? "").trim();
  if (!e) return b;
  const d = new Date().toISOString().slice(0, 10);
  return `--- Web research (${d}) ---\n${b}\n\n${e}`;
}

export async function researchCompanyPartnerships(
  supabase: SupabaseClient,
  profile: Profile,
  params: {
    company_name: string;
    website?: string | null;
    pipeline_id?: string | null;
    save_to_pipeline?: boolean;
  }
) {
  const companyName = String(params.company_name ?? "").trim();
  if (!companyName) return { error: "company_name is required" };

  let websiteHint = params.website?.trim() || undefined;
  let pipelineId = params.pipeline_id?.trim() || "";
  let existingPartnerships: string | null = null;

  if (pipelineId) {
    const { data: card, error } = await supabase
      .from("crm_companies_pipeline")
      .select("id, created_by_user_id, website_url, past_partnerships, companies(name, website)")
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
      | { name?: string | null; website?: string | null }
      | null
      | undefined;
    websiteHint =
      websiteHint ??
      companyWebsiteHintFromParts(card.website_url, company?.website);
    existingPartnerships = card.past_partnerships ?? null;
  }

  const result = await runPartnershipResearch(companyName, websiteHint ?? null);
  const found = result.found && isAcceptablePartnershipMarkdown(result.markdown);

  if (!found) {
    return {
      company_name: companyName,
      found: false as const,
      markdown: "",
      research_backend: result.meta.researchBackend,
      source_urls: result.meta.sourceUrls,
      evidence_count: result.meta.evidenceCount,
    };
  }

  const saveToPipeline = params.save_to_pipeline !== false && !!pipelineId;
  let past_partnerships: string | null = null;
  if (saveToPipeline) {
    const merged = mergeResearchBlock(existingPartnerships, result.markdown);
    const { error: upErr } = await supabase
      .from("crm_companies_pipeline")
      .update({ past_partnerships: merged })
      .eq("id", pipelineId);
    if (upErr) return { error: upErr.message };
    past_partnerships = merged;
  }

  return {
    company_name: companyName,
    found: true as const,
    markdown: result.markdown,
    past_partnerships,
    saved_to_pipeline: saveToPipeline,
    research_backend: result.meta.researchBackend,
    source_urls: result.meta.sourceUrls,
    evidence_count: result.meta.evidenceCount,
  };
}
