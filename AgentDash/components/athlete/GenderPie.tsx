import { audiencePercentPoints, fmtPct } from "@/lib/athlete-data";

export type GenderPieRow = {
  name: string;
  ig_audience_percent: number | null | undefined;
  ig_audience_count?: number | null | undefined;
};

type Props = {
  rows: GenderPieRow[];
  emptyText?: string;
  /** Diameter in pixels for the SVG. */
  size?: number;
};

const PRIMARY = "#2E7040";
const MUTED = "rgba(255, 255, 255, 0.10)";

function fmtCount(val: number | null | undefined): string {
  if (val == null) return "—";
  return Number(val).toLocaleString();
}

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export function GenderPie({ rows, emptyText = "No gender data.", size = 128 }: Props) {
  const safe = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r.ig_audience_percent != null && Number.isFinite(Number(r.ig_audience_percent))
  );

  if (safe.length === 0) {
    return <p className="mt-2 text-sm text-[#B9B2A6]">{emptyText}</p>;
  }

  const withPoints = safe.map((r) => ({
    ...r,
    points: audiencePercentPoints(Number(r.ig_audience_percent)),
  }));

  const sorted = [...withPoints].sort((a, b) => b.points - a.points);

  const total = sorted.reduce((sum, r) => sum + r.points, 0);
  if (total <= 0) {
    return <p className="mt-2 text-sm text-[#B9B2A6]">{emptyText}</p>;
  }

  const colorFor = (index: number) => (index === 0 ? PRIMARY : MUTED);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  let cursor = -Math.PI / 2;
  const slices = sorted.map((row, idx) => {
    const fraction = row.points / total;
    const start = cursor;
    const end = cursor + fraction * Math.PI * 2;
    cursor = end;
    const fill = colorFor(idx);
    const isFullCircle = sorted.length === 1 || fraction >= 0.9999;
    return { row, start, end, fill, isFullCircle };
  });

  return (
    <div className="mt-2 flex items-start gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Gender breakdown pie chart"
        className="shrink-0"
      >
        {slices.map((s, idx) =>
          s.isFullCircle ? (
            <circle key={idx} cx={cx} cy={cy} r={r} fill={s.fill} />
          ) : (
            <path key={idx} d={arcPath(cx, cy, r, s.start, s.end)} fill={s.fill} />
          )
        )}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {sorted.map((row, idx) => (
          <li key={row.name} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ background: colorFor(idx) }}
            />
            <span className="truncate text-[#ECE7DF]">{row.name}</span>
            <span className="ml-auto shrink-0 font-medium text-[#ECE7DF]">
              {fmtPct(Number(row.ig_audience_percent))} ({fmtCount(row.ig_audience_count)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
