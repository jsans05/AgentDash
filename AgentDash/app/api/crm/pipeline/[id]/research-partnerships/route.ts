import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  companyWebsiteHintFromParts,
  isAcceptablePartnershipMarkdown,
  runPartnershipResearch,
} from "@/lib/ai/partnership-research-engine";
import { partnershipResearchErrorResponse } from "@/lib/ai/partnership-research";
import { hasWebSearchProvider } from "@/lib/ai/partnership-research";

function mergeResearchBlock(existing: string | null, block: string): string {
  const b = block.trim();
  const e = (existing ?? "").trim();
  if (!e) return b;
  const d = new Date().toISOString().slice(0, 10);
  return `--- Web research (${d}) ---\n${b}\n\n${e}`;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id } = await params;

  const { data: card, error: cardErr } = await supabase
    .from("crm_companies_pipeline")
    .select("id, created_by_user_id, website_url, past_partnerships, companies(name, website)")
    .eq("id", id)
    .single();

  if (cardErr || !card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (card.created_by_user_id !== profile.user_id && profile.role !== "admin" && profile.role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const company = (Array.isArray(card.companies) ? card.companies[0] : card.companies) as
    | { name?: string | null; website?: string | null }
    | null
    | undefined;
  const companyName = String(company?.name ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "Company has no name" }, { status: 400 });
  }

  const websiteHint = companyWebsiteHintFromParts(card.website_url, company?.website);

  try {
    const result = await runPartnershipResearch(companyName, websiteHint);
    const found = result.found && isAcceptablePartnershipMarkdown(result.markdown);

    if (!found) {
      return NextResponse.json({
        found: false,
        past_partnerships: card.past_partnerships ?? null,
        research_backend: result.meta.researchBackend,
        web_search_queries: result.meta.webSearchQueries,
        source_urls: result.meta.sourceUrls,
        search_entry_point_html: result.meta.searchEntryPointHtml,
        evidence_count: result.meta.evidenceCount,
        has_web_search: hasWebSearchProvider(),
        company_name: companyName,
      });
    }

    const merged = mergeResearchBlock(card.past_partnerships ?? null, result.markdown);

    const { error: upErr } = await supabase
      .from("crm_companies_pipeline")
      .update({ past_partnerships: merged })
      .eq("id", id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      found: true,
      past_partnerships: merged,
      research_backend: result.meta.researchBackend,
      web_search_queries: result.meta.webSearchQueries,
      source_urls: result.meta.sourceUrls,
      search_entry_point_html: result.meta.searchEntryPointHtml,
      evidence_count: result.meta.evidenceCount,
      company_name: companyName,
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("TAVILY_API_KEY")) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    const { body, status } = partnershipResearchErrorResponse(e, companyName);
    return NextResponse.json(body, { status });
  }
}
