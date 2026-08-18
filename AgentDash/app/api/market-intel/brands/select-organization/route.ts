import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { isNextRedirectError, unauthorizedResponse } from "@/lib/api/http-errors";
import { isApolloEnabled } from "@/lib/apollo/config";
import { selectBrandOrganization } from "@/lib/apollo/brand-org-candidates";
import { getAggregatedBrandsByKeys } from "@/lib/market-intel/queries";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  try {
    const profile = await requireMarketIntelAccess();
    if (!isApolloEnabled()) {
      return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const brandKey = String(body.brand_key ?? "").trim();
    const apollo_organization_id = String(body.apollo_organization_id ?? "").trim();
    if (!brandKey || !apollo_organization_id) {
      return NextResponse.json(
        { error: "brand_key and apollo_organization_id required" },
        { status: 400 }
      );
    }

    const supabaseAdmin = await createServiceRoleClient();
    const brands = await getAggregatedBrandsByKeys(supabaseAdmin, [brandKey]);
    const brand = brands.find((b) => b.key === brandKey);
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    try {
      const organization = await selectBrandOrganization(supabaseAdmin, {
        brand,
        apollo_organization_id,
        userId: profile.user_id,
      });
      return NextResponse.json({ organization });
    } catch (e) {
      if (e instanceof ApolloApiError) {
        return NextResponse.json(
          { error: e.message },
          { status: e.status >= 400 ? e.status : 502 }
        );
      }
      const msg = e instanceof Error ? e.message : "Failed to select organization";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (e) {
    if (isNextRedirectError(e)) {
      return unauthorizedResponse();
    }
    const msg = e instanceof Error ? e.message : "Failed to select organization";
    console.error("[market-intel/brands/select-organization]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
