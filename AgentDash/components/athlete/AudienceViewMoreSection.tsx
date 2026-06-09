"use client";

import { useState } from "react";
import { AudiencePercentExpandable } from "@/components/athlete/AudiencePercentExpandable";
import type { AudienceRow } from "@/lib/athlete-data";

type Props = {
  states: AudienceRow[];
  cities: AudienceRow[];
  ethnicity: AudienceRow[];
};

function toListRows(rows: AudienceRow[]) {
  return rows.map((r) => ({
    name: r.audience_name,
    ig_audience_percent: r.ig_audience_percent,
    ig_audience_count: r.ig_audience_count,
  }));
}

export function AudienceViewMoreSection({ states, cities, ethnicity }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasAny = states.length > 0 || cities.length > 0 || ethnicity.length > 0;

  if (!hasAny) return null;

  return (
    <div className="mt-4">
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center justify-center rounded-[5px] border border-[#D7D0C4]/40 bg-[#121614] px-10 py-2.5 text-sm font-serif text-[#F4F1EB] transition-colors hover:border-[#E8E4DC]/55 hover:bg-[#161918] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CEE4D4]/40"
        >
          {expanded ? "View less" : "View more"}
        </button>
      </div>
      {expanded && (
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
          {states.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[#D7D0C4]">Top States</h3>
              <AudiencePercentExpandable
                rows={toListRows(states)}
                countInLabel
                previewLimit={5}
                emptyText="No state data."
              />
            </div>
          )}
          {cities.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[#D7D0C4]">Top Cities</h3>
              <AudiencePercentExpandable
                rows={toListRows(cities)}
                countInLabel
                previewLimit={5}
                emptyText="No city data."
              />
            </div>
          )}
          {ethnicity.length > 0 && (
            <div className={states.length > 0 && cities.length > 0 ? "sm:col-span-2" : undefined}>
              <h3 className="text-sm font-medium text-[#D7D0C4]">Ethnicity</h3>
              <AudiencePercentExpandable
                rows={toListRows(ethnicity)}
                countInLabel
                previewLimit={5}
                emptyText="No ethnicity data."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
