import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { apolloMaxSeedsPerExpand, isApolloEnabled } from "@/lib/apollo/config";
import {
  expandSimilarCompanies,
  loadExpandSeedsFromCompanyIds,
  resolveSeedsByName,
} from "@/lib/apollo/expand-similar";
import { domainFromWebsite, normalizeDomainForCompare } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const companyIds = Array.isArray(body.seed_company_ids)
    ? ([...new Set(body.seed_company_ids.map((id: unknown) => String(id)).filter(Boolean))] as string[])
    : [];
  const companyNames = Array.isArray(body.seed_company_names)
    ? body.seed_company_names.map(String).filter(Boolean)
    : [];

  if (companyIds.length === 0 && companyNames.length === 0) {
    return NextResponse.json({ error: "seed_company_ids or seed_company_names required" }, { status: 400 });
  }
  if (companyIds.length + companyNames.length > apolloMaxSeedsPerExpand()) {
    return NextResponse.json(
      { error: `Max ${apolloMaxSeedsPerExpand()} seeds per expand request` },
      { status: 400 }
    );
  }

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const byId = companyIds.length > 0 ? await loadExpandSeedsFromCompanyIds(supabaseAdmin, companyIds) : [];
    const byName = companyNames.length > 0 ? await resolveSeedsByName(supabaseAdmin, companyNames) : [];
    const seeds = [...byId, ...byName].slice(0, apolloMaxSeedsPerExpand());

    const exclude_domains: string[] = Array.isArray(body.exclude_domains)
      ? body.exclude_domains.map(String)
      : [];

    if (body.athlete_id) {
      const { fetchAthleteTargetListRows } = await import("@/lib/crm/athlete-target-list");
      const targetRows = await fetchAthleteTargetListRows(
        supabaseAdmin,
        profile.user_id,
        String(body.athlete_id)
      );
      for (const row of targetRows) {
        const d = domainFromWebsite(row.website);
        if (d) exclude_domains.push(d);
      }
    }

    const groups = await expandSimilarCompanies({
      seeds,
      category: body.category != null ? String(body.category) : undefined,
      revenue_range_min: body.revenue_range?.min != null ? Number(body.revenue_range.min) : undefined,
      revenue_range_max: body.revenue_range?.max != null ? Number(body.revenue_range.max) : undefined,
      organization_locations: Array.isArray(body.organization_locations)
        ? body.organization_locations.map(String)
        : undefined,
      limit_per_seed: body.limit_per_seed != null ? Number(body.limit_per_seed) : 5,
      exclude_domains: [...new Set(exclude_domains.map(normalizeDomainForCompare).filter(Boolean))],
    });

    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "mixed_companies/search",
    });
    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "organizations/enrich",
    });

    const summary = {
      seeds: seeds.length,
      total_similar: groups.reduce((n, g) => n + g.similar.length, 0),
    };

    return NextResponse.json({ summary, groups });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Expand similar failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
