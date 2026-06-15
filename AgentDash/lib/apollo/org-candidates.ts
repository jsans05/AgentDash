import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomainFull, searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
import {
  categoryToApolloKeywordTags,
  orgMatchConfidence,
  pickBestApolloOrganization,
  scoreApolloOrganizationCandidate,
  type OrgMatchContext,
} from "@/lib/apollo/org-match-scoring";
import type { ApolloOrganizationResult } from "@/lib/apollo/org-search-types";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import type { ResolvedOrganization } from "@/lib/apollo/types";

export type CompanyOrgRow = {
  company_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  product_category: string | null;
  apollo_organization_id: string | null;
  hq_phone: string | null;
};

export type OrgCandidateRow = {
  apollo_organization_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  score: number;
  primary_domain: string | null;
  match_confidence: "high" | "medium" | "low";
  selected: boolean;
};

export async function loadCompanyOrgRow(
  supabaseAdmin: SupabaseClient,
  companyId: string
): Promise<CompanyOrgRow> {
  const { data: company, error } = await supabaseAdmin
    .from("companies")
    .select("company_id, name, website, industry, product_category, apollo_organization_id, hq_phone")
    .eq("company_id", companyId)
    .single();

  if (error || !company) {
    throw new Error(error?.message ?? "Company not found");
  }

  return {
    company_id: companyId,
    name: String(company.name ?? "").trim(),
    website: company.website ? String(company.website) : null,
    industry: company.industry ? String(company.industry) : null,
    product_category: company.product_category ? String(company.product_category) : null,
    apollo_organization_id: company.apollo_organization_id
      ? String(company.apollo_organization_id)
      : null,
    hq_phone: company.hq_phone ? String(company.hq_phone) : null,
  };
}

function matchContextFromCompany(company: CompanyOrgRow): OrgMatchContext {
  return {
    companyName: company.name,
    productCategory: company.product_category,
    industry: company.industry,
  };
}

export async function searchApolloOrganizationsForCompany(
  company: CompanyOrgRow
): Promise<ApolloOrganizationResult[]> {
  const matchContext = matchContextFromCompany(company);
  const keywordTags = categoryToApolloKeywordTags(
    company.product_category,
    company.industry
  );

  let { organizations } = await searchApolloOrganizationsAdvanced({
    q_organization_name: company.name,
    keyword_tags: keywordTags.length > 0 ? keywordTags : undefined,
    per_page: 15,
  });

  if (organizations.length === 0 && keywordTags.length > 0) {
    ({ organizations } = await searchApolloOrganizationsAdvanced({
      q_organization_name: company.name,
      per_page: 15,
    }));
  }

  return organizations;
}

function orgToCandidate(
  org: ApolloOrganizationResult,
  ctx: OrgMatchContext,
  resolvedViaDomain: boolean,
  selected: boolean
): OrgCandidateRow | null {
  const id = org.apollo_organization_id;
  if (!id) return null;
  return {
    apollo_organization_id: id,
    name: org.name,
    website: org.website ?? null,
    industry: org.industry ?? null,
    description: org.description ?? null,
    score: scoreApolloOrganizationCandidate(org, ctx),
    primary_domain: org.primary_domain ?? null,
    match_confidence: orgMatchConfidence(org, ctx, resolvedViaDomain),
    selected,
  };
}

export async function listApolloOrganizationCandidates(
  supabaseAdmin: SupabaseClient,
  companyId: string
): Promise<{
  company_id: string;
  company_name: string;
  product_category: string | null;
  current: OrgCandidateRow | null;
  candidates: OrgCandidateRow[];
  best: OrgCandidateRow | null;
}> {
  const company = await loadCompanyOrgRow(supabaseAdmin, companyId);
  const ctx = matchContextFromCompany(company);
  const storedId = company.apollo_organization_id;
  const domain = domainFromWebsite(company.website);

  let domainOrg: ApolloOrganizationResult | null = null;
  if (domain) {
    const enriched = await enrichOrganizationByDomainFull(domain);
    if (enriched.apollo_organization_id) {
      domainOrg = {
        apollo_organization_id: enriched.apollo_organization_id,
        name: enriched.name ?? company.name,
        industry: enriched.industry ?? undefined,
        website: enriched.website ?? company.website ?? undefined,
        primary_domain: domain,
      };
    }
  }

  const searched = await searchApolloOrganizationsForCompany(company);
  const merged = new Map<string, ApolloOrganizationResult>();
  for (const org of searched) {
    if (org.apollo_organization_id) merged.set(org.apollo_organization_id, org);
  }
  if (domainOrg?.apollo_organization_id) {
    merged.set(domainOrg.apollo_organization_id, domainOrg);
  }

  const organizations = [...merged.values()];
  const bestOrg = pickBestApolloOrganization(organizations, ctx);
  const candidates = organizations
    .map((org) =>
      orgToCandidate(
        org,
        ctx,
        Boolean(domain && org.apollo_organization_id === domainOrg?.apollo_organization_id),
        storedId != null && org.apollo_organization_id === storedId
      )
    )
    .filter((c): c is OrgCandidateRow => c != null)
    .sort((a, b) => b.score - a.score);

  const best =
    bestOrg != null
      ? candidates.find((c) => c.apollo_organization_id === bestOrg.apollo_organization_id) ??
        orgToCandidate(bestOrg, ctx, Boolean(domainOrg), false)
      : null;

  const current =
    storedId != null
      ? candidates.find((c) => c.apollo_organization_id === storedId) ?? null
      : domainOrg?.apollo_organization_id
        ? candidates.find((c) => c.apollo_organization_id === domainOrg.apollo_organization_id) ??
          orgToCandidate(domainOrg, ctx, true, true)
        : best;

  return {
    company_id: companyId,
    company_name: company.name,
    product_category: company.product_category,
    current: current ?? null,
    candidates,
    best: best ?? null,
  };
}

function websiteFromOrg(org: ApolloOrganizationResult): string | null {
  const raw = org.website?.trim();
  if (raw) return raw;
  const domain = org.primary_domain?.trim();
  if (!domain) return null;
  return domain.startsWith("http") ? domain : `https://${domain.replace(/^www\./i, "")}`;
}

export async function selectApolloOrganization(
  supabaseAdmin: SupabaseClient,
  params: {
    companyId: string;
    apollo_organization_id: string;
    userId: string;
  }
): Promise<ResolvedOrganization & { pending_contacts_cleared: number }> {
  const company = await loadCompanyOrgRow(supabaseAdmin, params.companyId);
  const ctx = matchContextFromCompany(company);
  const targetId = String(params.apollo_organization_id).trim();
  if (!targetId) throw new Error("apollo_organization_id is required");

  const { candidates } = await listApolloOrganizationCandidates(supabaseAdmin, params.companyId);
  let picked = candidates.find((c) => c.apollo_organization_id === targetId);

  if (!picked) {
    const searched = await searchApolloOrganizationsForCompany(company);
    const org = searched.find((o) => o.apollo_organization_id === targetId);
    if (org) {
      const row = orgToCandidate(org, ctx, false, true);
      if (row) picked = row;
    }
  }

  if (!picked) {
    throw new Error("Organization not found in Apollo search results for this company");
  }

  const orgRow = candidates.find((c) => c.apollo_organization_id === targetId) ?? picked;
  const website = websiteFromOrg({
    apollo_organization_id: orgRow.apollo_organization_id,
    name: orgRow.name,
    website: orgRow.website ?? undefined,
    industry: orgRow.industry ?? undefined,
    description: orgRow.description ?? undefined,
    primary_domain: orgRow.primary_domain ?? undefined,
  });

  const patch: Record<string, string> = {
    apollo_organization_id: targetId,
  };
  if (website && !company.website) patch.website = website;
  if (orgRow.industry && !company.industry) patch.industry = orgRow.industry;

  const { error: upErr } = await supabaseAdmin
    .from("companies")
    .update(patch)
    .eq("company_id", params.companyId);
  if (upErr) throw new Error(upErr.message);

  const { data: pendingRows } = await supabaseAdmin
    .from("crm_contacts")
    .select("contact_id")
    .eq("company_id", params.companyId)
    .eq("created_by_user_id", params.userId)
    .eq("apollo_reveal_status", "pending");

  const pendingIds = (pendingRows ?? []).map((r) => String(r.contact_id));
  if (pendingIds.length > 0) {
    await supabaseAdmin.from("crm_contacts").delete().in("contact_id", pendingIds);
  }

  await logApolloUsage(supabaseAdmin, {
    user_id: params.userId,
    endpoint: "mixed_companies/search",
    company_id: params.companyId,
  });

  const domain =
    domainFromWebsite(website ?? company.website) ??
    (orgRow.primary_domain ? orgRow.primary_domain.replace(/^www\./i, "") : null);

  const match_notes = `Using Apollo org "${orgRow.name}" (selected manually)`;

  return {
    company_id: params.companyId,
    company_name: company.name,
    product_category: company.product_category,
    domain,
    apollo_organization_id: targetId,
    apollo_organization_name: orgRow.name,
    match_confidence: orgRow.match_confidence,
    match_notes,
    pending_contacts_cleared: pendingIds.length,
  };
}

export function resolvedOrgFromCandidate(
  company: CompanyOrgRow,
  candidate: OrgCandidateRow,
  opts: { viaDomain?: boolean; matchNotes?: string }
): ResolvedOrganization {
  const domain =
    domainFromWebsite(candidate.website) ??
    (candidate.primary_domain ? candidate.primary_domain.replace(/^www\./i, "") : null);

  return {
    company_id: company.company_id,
    company_name: company.name,
    product_category: company.product_category,
    domain,
    apollo_organization_id: candidate.apollo_organization_id,
    apollo_organization_name: candidate.name,
    match_confidence: candidate.match_confidence,
    match_notes: opts.matchNotes,
  };
}
