import { NextResponse } from "next/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { brandEnrichmentsByKey, getMarketIntelData } from "@/lib/market-intel/queries";
import { createServerClient } from "@/lib/supabase/server";

export async function GET() {
  await requireMarketIntelAccess();
  const supabase = await createServerClient();
  const data = await getMarketIntelData(supabase);
  return NextResponse.json({
    enrichments: data.brand_enrichments,
    enrichmentByKey: brandEnrichmentsByKey(data.brand_enrichments),
  });
}
