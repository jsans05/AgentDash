import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { selectBrandOrganization } from "@/lib/apollo/brand-org-candidates";
import { aggregateBrands, getMarketIntelData } from "@/lib/market-intel/queries";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ApolloApiError } from "@/lib/apollo/client";
export async function POST(req: Request) {
  const profile = await requireMarketIntelAccess();
  if (!isApolloEnabled()) {
    return NextResponse.json({
      error: "Apollo API is not configured"
    }, {
      status: 503
    });
  }
  const body = await req.json().catch(() => ({}));
  const brandKey = String(body.brand_key ?? "").trim();
  const apollo_organization_id = String(body.apollo_organization_id ?? "").trim();
  if (!brandKey || !apollo_organization_id) {
    return NextResponse.json({
      error: "brand_key and apollo_organization_id required"
    }, {
      status: 400
    });
  }
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const data = await getMarketIntelData(supabase);
  const brand = aggregateBrands(data.team_sponsors, data.venue_sponsors).find(b => b.key === brandKey);
  if (!brand) {
    return NextResponse.json({
      error: "Brand not found"
    }, {
      status: 404
    });
  }
  try {
    const organization = await selectBrandOrganization(supabaseAdmin, {
      brand,
      apollo_organization_id,
      userId: profile.user_id
    });
    return NextResponse.json({
      organization
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({
        error: e.message
      }, {
        status: e.status >= 400 ? e.status : 502
      });
    }
    const msg = e instanceof Error ? e.message : "Failed to select organization";
    return NextResponse.json({
      error: msg
    }, {
      status: 500
    });
  }
}