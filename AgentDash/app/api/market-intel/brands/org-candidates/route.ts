import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { listBrandOrganizationCandidates } from "@/lib/apollo/brand-org-candidates";
import { aggregateBrands, getMarketIntelData } from "@/lib/market-intel/queries";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ApolloApiError } from "@/lib/apollo/client";

export async function GET(req: Request) {
  const profile = await requireMarketIntelAccess();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const brandKey = url.searchParams.get("brand_key")?.trim();
  if (!brandKey) {
    return NextResponse.json({ error: "brand_key required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const data = await getMarketIntelData(supabase);
  const brand = aggregateBrands(data.team_sponsors, data.venue_sponsors).find(
    (b) => b.key === brandKey
  );

  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  try {
    const result = await listBrandOrganizationCandidates(
      supabaseAdmin,
      brand,
      profile.user_id
    );
    return NextResponse.json({
      current: result.current
        ? {
            apollo_organization_id: result.current.apollo_organization_id,
            apollo_organization_name: result.current.name,
            domain:
              result.current.primary_domain ??
              result.current.website?.replace(/^https?:\/\//i, "").split("/")[0] ??
              null,
            match_confidence: result.current.match_confidence,
          }
        : null,
      candidates: result.candidates,
      brand_key: result.brand_key,
      brand_name: result.brand_name,
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Failed to load organization candidates";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
