import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { findContactsForCompany } from "@/lib/apollo/find-company-contacts";
import { ApolloApiError } from "@/lib/apollo/client";
import type { ApolloContactSearchMode, ApolloPeopleSearchOverrides } from "@/lib/apollo/search-defaults";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const body = await req.json().catch(() => ({}));

  const overrides: ApolloPeopleSearchOverrides = {};
  if (Array.isArray(body.organization_locations)) {
    overrides.organization_locations = body.organization_locations.map(String);
  }
  if (body.revenue_range?.min != null) overrides.revenue_range_min = Number(body.revenue_range.min);
  if (body.revenue_range?.max != null) overrides.revenue_range_max = Number(body.revenue_range.max);
  if (body.page != null) overrides.page = Number(body.page);

  const searchMode: ApolloContactSearchMode =
    body.search_mode === "all_verified" ? "all_verified" : "partnership";

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await findContactsForCompany(supabaseAdmin, {
      userId: profile.user_id,
      companyId,
      overrides,
      searchMode,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Apollo search failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
