import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
import { logApolloUsage } from "@/lib/apollo/usage";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const keyword_tags = Array.isArray(body.keyword_tags)
    ? body.keyword_tags.map(String).filter(Boolean)
    : body.query
      ? [String(body.query).trim()].filter(Boolean)
      : [];

  if (keyword_tags.length === 0 && !body.q_organization_name) {
    return NextResponse.json({ error: "keyword_tags or query required" }, { status: 400 });
  }

  const exclude_domains = Array.isArray(body.exclude_domains)
    ? body.exclude_domains.map(String).filter(Boolean)
    : undefined;

  try {
    const result = await searchApolloOrganizationsAdvanced({
      keyword_tags,
      q_organization_name: body.q_organization_name ? String(body.q_organization_name) : undefined,
      revenue_range_min: body.revenue_range?.min != null ? Number(body.revenue_range.min) : undefined,
      revenue_range_max: body.revenue_range?.max != null ? Number(body.revenue_range.max) : undefined,
      organization_locations: Array.isArray(body.organization_locations)
        ? body.organization_locations.map(String)
        : undefined,
      organization_not_locations: Array.isArray(body.organization_not_locations)
        ? body.organization_not_locations.map(String)
        : undefined,
      organization_num_employees_ranges: Array.isArray(body.organization_num_employees_ranges)
        ? body.organization_num_employees_ranges.map(String)
        : undefined,
      page: body.page != null ? Number(body.page) : 1,
      per_page: body.per_page != null ? Number(body.per_page) : 15,
      exclude_domains,
    });

    const supabaseAdmin = await createServiceRoleClient();
    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "mixed_companies/search",
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Apollo company search failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
