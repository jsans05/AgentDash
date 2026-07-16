import { createServerClient } from "@/lib/supabase/server";
import { requireAdminOrSales } from "@/lib/auth";
import { fmtFollowers } from "@/lib/athlete-data";
import { getRosterAudienceInsights } from "@/lib/insights/roster-audience-insights";
import { DemographicReach } from "@/components/insights/DemographicReach";
import { InterestReach } from "@/components/insights/InterestReach";
import { BrandAffinities } from "@/components/insights/BrandAffinities";
import { ReachBySport } from "@/components/insights/ReachBySport";
import { SportIndustryCoverage } from "@/components/insights/SportIndustryCoverage";
import { AudiencePivotTable } from "@/components/insights/AudiencePivotTable";

export default async function InsightsPage() {
  const profile = await requireAdminOrSales();
  const supabase = await createServerClient();
  const data = await getRosterAudienceInsights(supabase, profile);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Roster audience intelligence</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          Demographic reach, interest reach, and brand affinities across the roster — Instagram audience data from CreatorIQ imports.
        </p>
      </div>

      <div className="space-y-6">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <h2 className="text-sm font-medium text-[#B9B2A6]">Total reach</h2>
              <p className="mt-1 text-3xl font-semibold text-[#ECE7DF]">{fmtFollowers(data.total_reach)}</p>
              <p className="mt-1 text-xs text-[#8E877A]">Sum of total followers across all platforms</p>
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#B9B2A6]">Athletes with audience data</h2>
              <p className="mt-1 text-3xl font-semibold text-[#ECE7DF]">
                {data.athletes_with_audience_count}
                <span className="text-lg font-normal text-[#8E877A]"> / {data.total_athletes}</span>
              </p>
              <p className="mt-1 text-xs text-[#8E877A]">Athletes with any imported IG audience rows</p>
            </div>
            <div>
              <h2 className="text-sm font-medium text-[#B9B2A6]">Data scope</h2>
              <p className="mt-1 text-sm text-[#ECE7DF]">Instagram audience only</p>
              <p className="mt-1 text-xs text-[#8E877A]">
                Counts use # IG Audience when available; otherwise estimated from % × IG followers.
              </p>
            </div>
          </div>
        </section>

        <DemographicReach gender={data.gender} age={data.age} countries={data.countries} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <InterestReach interests={data.interests} />
          <BrandAffinities brands={data.brands} />
        </div>

        <ReachBySport rows={data.reach_by_sport} />

        <SportIndustryCoverage rows={data.sport_industry_coverage} />

        <AudiencePivotTable pivot={data.pivot} />
      </div>
    </div>
  );
}
