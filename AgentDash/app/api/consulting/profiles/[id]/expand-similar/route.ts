import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled, apolloMaxSeedsPerExpand } from "@/lib/apollo/config";
import {
  expandSimilarCompanies,
  loadExpandSeedsFromCompanyIds,
} from "@/lib/apollo/expand-similar";
import { domainFromWebsite, normalizeDomainForCompare } from "@/lib/apollo/org-search-utils";
import { logApolloUsage } from "@/lib/apollo/usage";
import { ApolloApiError } from "@/lib/apollo/client";
import { requireConsultingProfileAccess, ConsultingAccessError } from "@/lib/consulting/access";
import { getConsultingTargetListDomains } from "@/lib/crm/consulting-target-list";
import { getOrCreateCompanyByName } from "@/lib/consulting/companies";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { id: consultingProfileId } = await params;
  const supabaseAdmin = await createServiceRoleClient();

  try {
    await requireConsultingProfileAccess(supabaseAdmin, profile, consultingProfileId);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const industryCategory =
    body.industry_category != null ? String(body.industry_category).trim() || null : null;
  if (!industryCategory) {
    return NextResponse.json({ error: "industry_category required" }, { status: 400 });
  }

  const seedCompanyIds = Array.isArray(body.seed_company_ids)
    ? ([...new Set(body.seed_company_ids.map((id: unknown) => String(id)).filter(Boolean))] as string[])
    : [];

  if (seedCompanyIds.length === 0) {
    const { data: seeds } = await supabaseAdmin
      .from("consulting_profile_seeds")
      .select("company_id")
      .eq("profile_id", consultingProfileId);
    for (const s of seeds ?? []) {
      if (s.company_id) seedCompanyIds.push(String(s.company_id));
    }
  }

  if (seedCompanyIds.length === 0) {
    return NextResponse.json({ error: "No seed companies configured" }, { status: 400 });
  }
  if (seedCompanyIds.length > apolloMaxSeedsPerExpand()) {
    return NextResponse.json(
      { error: `Max ${apolloMaxSeedsPerExpand()} seeds per expand request` },
      { status: 400 }
    );
  }

  try {
    const seeds = await loadExpandSeedsFromCompanyIds(supabaseAdmin, seedCompanyIds);
    const exclude_domains = await getConsultingTargetListDomains(supabaseAdmin, consultingProfileId);
    for (const s of seeds) {
      const d = domainFromWebsite(s.website);
      if (d) exclude_domains.push(normalizeDomainForCompare(d));
    }

    const groups = await expandSimilarCompanies({
      seeds,
      category: industryCategory,
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

    let added = 0;
    const preview: Array<{ name: string; website: string | null; seed: string }> = [];

    if (body.add_to_target_list === true) {
      for (const group of groups) {
        for (const org of group.similar) {
          const name = String(org.name ?? "").trim();
          if (!name) continue;
          const companyId = await getOrCreateCompanyByName(supabaseAdmin, name);
          if (org.website) {
            await supabaseAdmin
              .from("companies")
              .update({
                website: org.website,
                product_category: industryCategory,
              })
              .eq("company_id", companyId);
          }
          const { error } = await supabaseAdmin.from("consulting_target_list").upsert(
            {
              consulting_profile_id: consultingProfileId,
              company_id: companyId,
              industry_category: industryCategory,
              added_by_user_id: profile.user_id,
            },
            { onConflict: "consulting_profile_id,company_id" }
          );
          if (!error) added++;
        }
      }
    } else {
      for (const group of groups) {
        for (const org of group.similar) {
          preview.push({
            name: String(org.name ?? ""),
            website: org.website ?? null,
            seed: group.seed.company_name,
          });
        }
      }
    }

    return NextResponse.json({
      summary: {
        seeds: seeds.length,
        total_similar: groups.reduce((n, g) => n + g.similar.length, 0),
        added,
      },
      groups: body.add_to_target_list === true ? undefined : groups,
      preview: preview.length > 0 ? preview : undefined,
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Expand similar failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
