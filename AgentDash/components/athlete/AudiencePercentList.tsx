import { audiencePercentPoints, fmtPct } from "@/lib/athlete-data";

export type AudiencePercentListRow = {
  name: string;
  /** Raw `ig_audience_percent` value (0–1 fraction or 0–100 points); formatter normalizes. */
  ig_audience_percent: number | null | undefined;
  ig_audience_count?: number | null | undefined;
};

function fmtCount(val: number | null | undefined): string {
  if (val == null) return "—";
  return Number(val).toLocaleString();
}

export function AudiencePercentList(props: {
  rows: AudiencePercentListRow[];
  limit?: number;
  showCount?: boolean;
  /** When true, render the raw IG audience count in parentheses next to the percent on the label row. */
  countInLabel?: boolean;
  emptyText?: string;
}) {
  const showCount = props.showCount ?? false;
  const countInLabel = props.countInLabel ?? false;
  const emptyText = props.emptyText ?? "No data available.";

  const safeRows = Array.isArray(props.rows) ? props.rows : [];
  const requested = props.limit ?? 5;
  const take = Math.min(Math.max(1, requested), safeRows.length);
  const visible = safeRows.slice(0, take);

  const pctPoints = visible.map((r) =>
    r.ig_audience_percent == null ? 0 : audiencePercentPoints(Number(r.ig_audience_percent))
  );
  const maxPct = Math.max(0, ...pctPoints);

  if (visible.length === 0) {
    return <p className="text-sm text-[#B9B2A6]">{emptyText}</p>;
  }

  return (
    <ul className="mt-2 space-y-2">
      {visible.map((r) => {
        const pct =
          r.ig_audience_percent == null ? null : audiencePercentPoints(Number(r.ig_audience_percent));
        const fill = pct == null || maxPct <= 0 ? 0 : Math.max(0, Math.min(100, (pct / maxPct) * 100));

        return (
          <li key={r.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-center">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-[#ECE7DF]">{r.name}</span>
                <span className="shrink-0 text-sm font-medium text-[#ECE7DF]">
                  {r.ig_audience_percent == null
                    ? "—"
                    : countInLabel
                      ? `${fmtPct(Number(r.ig_audience_percent))} (${fmtCount(r.ig_audience_count)})`
                      : fmtPct(Number(r.ig_audience_percent))}
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded bg-white/10">
                <div className="h-2 rounded bg-[#2E7040]" style={{ width: `${fill}%` }} />
              </div>
            </div>

            {showCount ? (
              <span className="text-right text-xs tabular-nums text-[#B9B2A6]">
                {fmtCount(r.ig_audience_count)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

