import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { requireAdminOrSales } from "@/lib/auth";
import { fmtEngagementRate, fmtFollowers } from "@/lib/athlete-data";
import { formatContractDateForDisplay } from "@/lib/contracts";
import { getRosterIntelligence } from "@/lib/insights/roster-intelligence";

export default async function InsightsPage() {
  const profile = await requireAdminOrSales();
  const supabase = await createServerClient();
  const data = await getRosterIntelligence(supabase, profile);

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Roster intelligence</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          Aggregate reach, engagement, contract risk, and CRM pipeline load across the roster.
        </p>
      </div>

      <div className="space-y-6">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
          <h2 className="text-lg font-medium text-[#F4F1EB]">Total reach</h2>
          <p className="mt-2 text-3xl font-semibold text-[#ECE7DF]">{fmtFollowers(data.total_reach)}</p>
          <p className="mt-1 text-xs text-[#B9B2A6]">Sum of total followers across athletes with social data</p>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
            <h2 className="text-lg font-medium text-[#F4F1EB]">Reach by sport</h2>
            {data.reach_by_sport.length === 0 ? (
              <p className="mt-3 text-sm text-[#B9B2A6]">No social data available.</p>
            ) : (
              <ul className="mt-4 divide-y divide-white/10">
                {data.reach_by_sport.map((row) => (
                  <li key={row.sport} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-[#ECE7DF]">
                      {row.sport}{" "}
                      <span className="text-[#8E877A]">({row.athlete_count})</span>
                    </span>
                    <span className="font-medium text-[#CEE4D4]">{fmtFollowers(row.total_followers)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
            <h2 className="text-lg font-medium text-[#F4F1EB]">Avg. ER by sport</h2>
            {data.avg_er_by_sport.length === 0 ? (
              <p className="mt-3 text-sm text-[#B9B2A6]">No engagement rate data available.</p>
            ) : (
              <ul className="mt-4 divide-y divide-white/10">
                {data.avg_er_by_sport.map((row) => (
                  <li key={row.sport} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-[#ECE7DF]">
                      {row.sport}{" "}
                      <span className="text-[#8E877A]">({row.athlete_count})</span>
                    </span>
                    <span className="font-medium text-[#CEE4D4]">{fmtEngagementRate(row.avg_er_20p)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
          <h2 className="text-lg font-medium text-[#F4F1EB]">CRM pipeline by stage</h2>
          <p className="mt-1 text-xs text-[#B9B2A6]">Non-archived cards in your in-progress pipeline</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {data.pipeline_stage_counts.map((row) => (
              <div
                key={row.stage}
                className="rounded-md border border-white/10 bg-[#1A211D] px-3 py-2 text-center min-w-[5.5rem]"
              >
                <div className="text-lg font-semibold text-[#ECE7DF]">{row.count}</div>
                <div className="text-xs text-[#B9B2A6]">{row.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
          <h2 className="text-lg font-medium text-[#F4F1EB]">Contracts expiring within 90 days</h2>
          {data.expiring_contracts.length === 0 ? (
            <p className="mt-3 text-sm text-[#B9B2A6]">No active contracts ending in the next 90 days.</p>
          ) : (
            <ul className="mt-4 divide-y divide-white/10">
              {data.expiring_contracts.map((row) => (
                <li key={row.contract_id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[#ECE7DF]">
                      <Link href={`/athlete/${row.athlete_id}`} className="text-[#CEE4D4] hover:text-[#E8F6ED]">
                        {row.athlete_name}
                      </Link>
                      {" · "}
                      {row.company_name}
                    </span>
                    <span className="text-[#B9B2A6]">
                      Ends {formatContractDateForDisplay(row.end_date) ?? row.end_date} ({row.days_until_end}d)
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
