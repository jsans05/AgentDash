import { fmtFollowers } from "@/lib/athlete-data";
import type { ReachBySportRow } from "@/lib/insights/roster-audience-insights";

type Props = {
  rows: ReachBySportRow[];
};

export function ReachBySport({ rows }: Props) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="text-lg font-medium text-[#F4F1EB]">Reach by sport</h2>
      <p className="mt-1 text-xs text-[#B9B2A6]">Total followers across all platforms per sport</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#B9B2A6]">No social data available.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/10">
          {rows.map((row) => (
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
  );
}
