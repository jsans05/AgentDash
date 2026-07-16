"use client";

import { useMemo, useState } from "react";
import type { PivotCube, PivotDimension } from "@/lib/insights/roster-audience-insights";
import { PIVOT_DIMENSIONS } from "@/lib/insights/roster-audience-insights";

const DIMENSION_LABELS: Record<PivotDimension, string> = {
  Interests: "Interest",
  Brands: "Brand",
  Combined_Age: "Age",
  Gender: "Gender",
  Countries: "Country",
};

function fmtCount(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return val.toLocaleString();
}

type Props = {
  pivot: PivotCube;
};

type ResolvedCell = {
  count: number;
  athlete_count: number;
};

function resolveCellValue(
  sportData: Record<string, ResolvedCell> | undefined,
  column: string,
  explicitColumns: string[]
): ResolvedCell {
  if (!sportData) return { count: 0, athlete_count: 0 };

  if (column !== "Other") {
    return sportData[column] ?? { count: 0, athlete_count: 0 };
  }

  const topSet = new Set(explicitColumns.filter((c) => c !== "Other"));
  let count = 0;
  for (const [name, cell] of Object.entries(sportData)) {
    if (topSet.has(name)) continue;
    count += cell.count;
  }
  return { count, athlete_count: 0 };
}

export function AudiencePivotTable({ pivot }: Props) {
  const [dimension, setDimension] = useState<PivotDimension>("Interests");

  const { columns, matrix } = useMemo(() => {
    const cols = pivot.columnsByDimension[dimension] ?? [];
    const sportRows = pivot.sports.filter((sport) => {
      const dimData = pivot.bySport[sport]?.[dimension];
      return dimData && Object.keys(dimData).length > 0;
    });

    const sortedSports = [...sportRows].sort((a, b) => {
      const aTotal = Object.values(pivot.bySport[a]?.[dimension] ?? {}).reduce((s, c) => s + c.count, 0);
      const bTotal = Object.values(pivot.bySport[b]?.[dimension] ?? {}).reduce((s, c) => s + c.count, 0);
      return bTotal - aTotal;
    });

    const rows = sortedSports.map((sport) => {
      const dimData = pivot.bySport[sport]?.[dimension] ?? {};
      const cells = cols.map((col) => resolveCellValue(dimData, col, cols));
      const rowTotal = cells.reduce((s, c) => s + c.count, 0);
      return { sport, cells, rowTotal };
    });

    return { columns: cols, matrix: rows };
  }, [pivot, dimension]);

  if (pivot.sports.length === 0) {
    return (
      <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
        <h2 className="text-lg font-medium text-[#F4F1EB]">Audience pivot</h2>
        <p className="mt-3 text-sm text-[#B9B2A6]">No pivot data available.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-[#F4F1EB]">Audience pivot</h2>
          <p className="mt-1 text-xs text-[#B9B2A6]">
            Sport rows × selected audience dimension. Cell values are estimated IG audience counts.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#B9B2A6]">
          <span>Columns</span>
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value as PivotDimension)}
            className="rounded-md border border-white/10 bg-[#1A211D] px-3 py-1.5 text-sm text-[#ECE7DF] focus:border-[#2E7040] focus:outline-none"
          >
            {PIVOT_DIMENSIONS.map((dim) => (
              <option key={dim} value={dim}>
                {DIMENSION_LABELS[dim]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {matrix.length === 0 || columns.length === 0 ? (
        <p className="mt-4 text-sm text-[#B9B2A6]">No data for this dimension.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="sticky left-0 z-10 bg-[#151A17] px-3 py-2 font-medium text-[#B9B2A6]">Sport</th>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-2 font-medium text-[#B9B2A6] whitespace-nowrap">
                    {col}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-[#B9B2A6]">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.sport} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="sticky left-0 z-10 bg-[#151A17] px-3 py-2 font-medium text-[#ECE7DF] whitespace-nowrap">
                    {row.sport}
                  </td>
                  {row.cells.map((cell, idx) => (
                    <td key={`${row.sport}-${columns[idx]}`} className="px-3 py-2 text-[#CEE4D4] whitespace-nowrap">
                      {cell.count > 0 ? (
                        <span title={`${cell.athlete_count} athletes`}>{fmtCount(cell.count)}</span>
                      ) : (
                        <span className="text-[#8E877A]">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 font-medium text-[#ECE7DF] whitespace-nowrap">
                    {fmtCount(row.rowTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
