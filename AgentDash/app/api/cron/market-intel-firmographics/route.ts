import { NextResponse } from "next/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import {
  authorizeCron,
  cronSystemUserId,
  FIRMOGRAPHICS_BATCH_LIMIT,
  FIRMOGRAPHICS_STALE_DAYS,
} from "@/lib/market-intel/cron-config";
import { prepareBrandEnrich } from "@/lib/market-intel/enrich-brand-flow";
import {
  aggregateBrands,
  brandQualifiesForAutoFirmographics,
  getMarketIntelData,
  hasBrandApolloFirmographics,
} from "@/lib/market-intel/queries";
import { isFirmographicsStale } from "@/lib/crm/company-firmographics";
import { createServiceRoleClient } from "@/lib/supabase/server";

type WorkItem = {
  brandKey: string;
  mode: "trigger" | "refresh";
  apollo_organization_id?: string;
};

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isApolloEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Apollo integration is not configured",
    });
  }

  const supabaseAdmin = await createServiceRoleClient();
  const data = await getMarketIntelData(supabaseAdmin);
  const brands = aggregateBrands(data.team_sponsors, data.venue_sponsors);
  const enrichmentByKey = Object.fromEntries(
    data.brand_enrichments.map((row) => [row.company_name_normalized, row])
  );
  const venueSportByKey = new Map(
    data.venues.map((venue) => [venue.entity_key, venue.sport_type])
  );

  const work: WorkItem[] = [];

  for (const brand of brands) {
    if (!brandQualifiesForAutoFirmographics(brand, venueSportByKey)) continue;

    const enrichment = enrichmentByKey[brand.key];
    const hasFirmographics = hasBrandApolloFirmographics(enrichment);

    if (!hasFirmographics) {
      work.push({ brandKey: brand.key, mode: "trigger" });
      continue;
    }

    if (
      enrichment?.enriched_at &&
      isFirmographicsStale(enrichment.enriched_at, FIRMOGRAPHICS_STALE_DAYS)
    ) {
      work.push({
        brandKey: brand.key,
        mode: "refresh",
        apollo_organization_id: enrichment.apollo_organization_id ?? undefined,
      });
    }
  }

  const batch = work.slice(0, FIRMOGRAPHICS_BATCH_LIMIT);
  const userId = cronSystemUserId();

  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of batch) {
    const brand = brands.find((b) => b.key === item.brandKey);
    if (!brand) continue;

    try {
      const result = await prepareBrandEnrich(supabaseAdmin, brand, userId, {
        apollo_organization_id: item.apollo_organization_id,
        force: item.mode === "refresh" && Boolean(item.apollo_organization_id),
      });

      if (result.needsConfirmation) {
        skipped += 1;
        continue;
      }

      enriched += 1;
    } catch (e) {
      failed += 1;
      errors.push(
        `${brand.displayName}: ${e instanceof Error ? e.message : "failed"}`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    queued: work.length,
    enriched,
    skipped,
    failed,
    remaining: Math.max(work.length - batch.length, 0),
    errors: errors.slice(0, 10),
  });
}

export async function POST(req: Request) {
  return GET(req);
}
