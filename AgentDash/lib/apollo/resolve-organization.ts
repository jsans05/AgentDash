import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichOrganizationByDomainFull } from "@/lib/apollo/organizations";
import {
  listApolloOrganizationCandidates,
  loadCompanyOrgRow,
  resolvedOrgFromCandidate,
  searchApolloOrganizationsForCompany,
} from "@/lib/apollo/org-candidates";
import {
  orgMatchConfidence,
  personMatchesResolvedOrg,
  pickBestApolloOrganization,
} from "@/lib/apollo/org-match-scoring";
import { domainFromWebsite } from "@/lib/apollo/org-search-utils";
import type { ResolvedOrganization } from "@/lib/apollo/types";

export { listApolloOrganizationCandidates, selectApolloOrganization } from "@/lib/apollo/org-candidates";

export async function resolveOrganizationForCompany(
  supabaseAdmin: SupabaseClient,
  companyId: string
): Promise<ResolvedOrganization> {
  const company = await loadCompanyOrgRow(supabaseAdmin, companyId);
  const company_name = company.name;
  const product_category = company.product_category;
  const domainFromSite = domainFromWebsite(company.website);

  if (domainFromSite) {
    const enriched = await enrichOrganizationByDomainFull(domainFromSite);
    const patch: Record<string, string> = {};
    if (enriched.apollo_organization_id && enriched.apollo_organization_id !== company.apollo_organization_id) {
      patch.apollo_organization_id = enriched.apollo_organization_id;
    }
    if (enriched.hq_phone && !company.hq_phone) {
      patch.hq_phone = enriched.hq_phone;
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
    }
    if (enriched.apollo_organization_id) {
      return {
        company_id: companyId,
        company_name,
        product_category,
        domain: domainFromSite,
        apollo_organization_id: enriched.apollo_organization_id,
        apollo_organization_name: enriched.name,
        match_confidence: "high",
        match_notes: `Matched by website domain (${domainFromSite})`,
      };
    }
  }

  const listed = await listApolloOrganizationCandidates(supabaseAdmin, companyId);
  const storedId = company.apollo_organization_id;

  let resolved = storedId
    ? listed.candidates.find((c) => c.apollo_organization_id === storedId) ?? listed.current
    : null;

  if (!resolved) {
    resolved = listed.best;
  }

  if (!resolved) {
    const organizations = await searchApolloOrganizationsForCompany(company);
    const best = pickBestApolloOrganization(organizations, {
      companyName: company_name,
      productCategory: product_category,
      industry: company.industry,
    });
    if (best?.apollo_organization_id) {
      const conf = orgMatchConfidence(
        best,
        { companyName: company_name, productCategory: product_category, industry: company.industry },
        false
      );
      let match_notes = product_category
        ? `Matched "${best.name}" using category "${product_category}"`
        : `Matched "${best.name}" by company name`;
      if (conf === "low") {
        match_notes += ". Add the company website for a more precise match.";
      }
      const org = resolvedOrgFromCandidate(company, {
        apollo_organization_id: best.apollo_organization_id,
        name: best.name,
        website: best.website ?? null,
        industry: best.industry ?? null,
        description: best.description ?? null,
        score: 0,
        primary_domain: best.primary_domain ?? null,
        match_confidence: conf,
        selected: false,
      }, { matchNotes: match_notes });

      const patch: Record<string, string> = {};
      if (best.apollo_organization_id !== company.apollo_organization_id) {
        patch.apollo_organization_id = best.apollo_organization_id;
      }
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
      }

      if (!org.domain && !org.apollo_organization_id) {
        const hint = product_category
          ? ` Add website or verify category "${product_category}" on the pipeline card.`
          : " Add a company website on the pipeline card.";
        throw new Error(`Could not resolve Apollo organization for "${company_name}".${hint}`);
      }
      return org;
    }
  }

  if (resolved) {
    let match_notes = resolved.selected
      ? `Using stored Apollo org "${resolved.name}"`
      : product_category
        ? `Matched "${resolved.name}" using category "${product_category}"`
        : `Matched "${resolved.name}" by company name`;
    if (resolved.match_confidence === "low") {
      match_notes += ". Add the company website for a more precise match.";
    }

    const patch: Record<string, string> = {};
    if (resolved.apollo_organization_id !== company.apollo_organization_id) {
      patch.apollo_organization_id = resolved.apollo_organization_id;
    }
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
    }

    const org = resolvedOrgFromCandidate(company, resolved, { matchNotes: match_notes });
    if (!org.domain && !org.apollo_organization_id) {
      const hint = product_category
        ? ` Add website or verify category "${product_category}" on the pipeline card.`
        : " Add a company website on the pipeline card.";
      throw new Error(`Could not resolve Apollo organization for "${company_name}".${hint}`);
    }
    return org;
  }

  const hint = product_category
    ? ` Add website or verify category "${product_category}" on the pipeline card.`
    : " Add a company website on the pipeline card.";
  throw new Error(`Could not resolve Apollo organization for "${company_name}".${hint}`);
}

/** Filter people search results to the resolved Apollo organization. */
export function filterPeopleForResolvedOrg<T extends { organization_name: string }>(
  people: T[],
  org: ResolvedOrganization
): T[] {
  const expected = org.apollo_organization_name ?? org.company_name;
  return people.filter((p) =>
    personMatchesResolvedOrg(p.organization_name, expected, org.company_name)
  );
}
