import type { AudienceCountRow } from "@/lib/insights/roster-audience-insights";

function fmtCount(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return val.toLocaleString();
}

type Props = {
  rows: AudienceCountRow[];
  limit?: number;
  emptyText?: string;
};

/** Roster-level reach list — counts only, bar width relative to top row (no misleading %). */
export function AudienceCountList({ rows, limit = 15, emptyText = "No data available." }: Props) {
  const visible = rows.slice(0, limit);
  const maxCount = Math.max(0, ...visible.map((r) => r.audience_count));

  if (visible.length === 0) {
    return <p className="text-sm text-[#B9B2A6]">{emptyText}</p>;
  }

  return (
    <ul className="mt-2 space-y-2">
      {visible.map((row) => {
        const fill = maxCount > 0 ? Math.max(0, Math.min(100, (row.audience_count / maxCount) * 100)) : 0;
        return (
          <li key={row.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-[#ECE7DF]">{row.name}</span>
                <span className="shrink-0 text-sm font-medium text-[#ECE7DF]">
                  {fmtCount(row.audience_count)}
                  <span className="ml-1 text-xs font-normal text-[#8E877A]">
                    ({row.athlete_count} athletes)
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded bg-white/10">
                <div className="h-2 rounded bg-[#2E7040]" style={{ width: `${fill}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
