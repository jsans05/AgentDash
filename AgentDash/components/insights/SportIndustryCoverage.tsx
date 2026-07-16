import type { SportIndustryCoverageRow } from "@/lib/insights/roster-audience-insights";

function fmtCount(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return val.toLocaleString();
}

type Props = {
  rows: SportIndustryCoverageRow[];
};

export function SportIndustryCoverage({ rows }: Props) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="text-lg font-medium text-[#F4F1EB]">Sport × industry coverage</h2>
      <p className="mt-1 text-xs text-[#B9B2A6]">
        Which buyer industries each sport unlocks, scored by summed interest reach on that sport&apos;s athletes.
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#B9B2A6]">No sport × industry data available.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {rows.map((row) => (
            <div key={row.sport}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-[#ECE7DF]">{row.sport}</h3>
                <span className="text-xs text-[#8E877A]">{row.athlete_count} athletes</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.industries.slice(0, 6).map((ind) => (
                  <div
                    key={ind.industry_key}
                    className="rounded-md border border-white/10 bg-[#1A211D] px-3 py-2 text-xs"
                  >
                    <div className="font-medium text-[#CEE4D4]">{fmtCount(ind.audience_count)}</div>
                    <div className="text-[#B9B2A6]">{ind.industry_label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
