import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { isNextRedirectError, unauthorizedResponse } from "@/lib/api/http-errors";
import { brandEnrichmentsByKey, getMarketIntelData } from "@/lib/market-intel/queries";
import { createServerClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    await requireMarketIntelAccess();
    const supabase = await createServerClient();
    const data = await getMarketIntelData(supabase);
    return NextResponse.json({
      enrichments: data.brand_enrichments,
      enrichmentByKey: brandEnrichmentsByKey(data.brand_enrichments),
    });
  } catch (e) {
    if (isNextRedirectError(e)) {
      return unauthorizedResponse();
    }
    const msg = e instanceof Error ? e.message : "Failed to load enrichments";
    console.error("[market-intel/brands/enrichment]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
