import { NextResponse } from "next/server";
import {
  authorizeCron,
  SOCIAL_BATCH_LIMIT,
} from "@/lib/market-intel/cron-config";
import { enrichBrandSocial, brandNeedsSocialRefresh } from "@/lib/market-intel/enrich-social";
import {
  aggregateBrands,
  getMarketIntelData,
} from "@/lib/market-intel/queries";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = await createServiceRoleClient();
  const data = await getMarketIntelData(supabaseAdmin);
  const brands = aggregateBrands(data.team_sponsors, data.venue_sponsors);
  const enrichmentByKey = Object.fromEntries(
    data.brand_enrichments.map((row) => [row.company_name_normalized, row])
  );

  const queue = brands.filter((brand) =>
    brandNeedsSocialRefresh(enrichmentByKey[brand.key])
  );
  const batch = queue.slice(0, SOCIAL_BATCH_LIMIT);

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const brand of batch) {
    try {
      await enrichBrandSocial(supabaseAdmin, brand);
      processed += 1;
    } catch (e) {
      failed += 1;
      errors.push(
        `${brand.displayName}: ${e instanceof Error ? e.message : "failed"}`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    queued: queue.length,
    processed,
    failed,
    remaining: Math.max(queue.length - batch.length, 0),
    errors: errors.slice(0, 10),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
