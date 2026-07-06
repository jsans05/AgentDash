import { createServerClient } from "@/lib/supabase/server";
import { requireMarketIntelAccess } from "@/lib/auth";
import { getMarketIntelData, brandEnrichmentsByKey } from "@/lib/market-intel/queries";
import { MarketIntelClient } from "@/components/market-intel/MarketIntelClient";

export default async function MarketIntelPage() {
  await requireMarketIntelAccess();
  const supabase = await createServerClient();
  const data = await getMarketIntelData(supabase);
  const enrichmentByKey = brandEnrichmentsByKey(data.brand_enrichments);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Market intel</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          NASCAR Cup standings, team sponsors/partners, and venue sponsors — refreshed by the
          market sponsor scraper.
        </p>
      </div>

      <MarketIntelClient
        cupDrivers={data.cup_drivers}
        teamSponsors={data.team_sponsors}
        venues={data.venues}
        venueSponsors={data.venue_sponsors}
        enrichmentByKey={enrichmentByKey}
        lastSyncAt={data.last_sync_at}
      />
    </div>
  );
}
