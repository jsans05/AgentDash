"use client";

import { useState } from "react";
import type { LocationsData, LocationRow } from "@/lib/ciq/overview";

const INITIAL_ROWS = 5;

function LocationList({
  rows,
  initialShow,
}: {
  rows: LocationRow[];
  initialShow: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const display = expanded ? rows : rows.slice(0, initialShow);
  const hasMore = rows.length > initialShow;

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">No data</p>;
  }

  return (
    <div>
      <div className="space-y-1.5">
        {display.map((row, i) => (
          <div key={`${row.name}-${i}`} className="flex items-center gap-2">
            <div
              className="h-2 flex-shrink-0 rounded bg-teal-500"
              style={{
                width: `${Math.min(100, row.value * 2)}%`,
                maxWidth: 120,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{row.name}</span>
            <span className="flex-shrink-0 text-sm font-medium text-gray-900">
              {row.value.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-sm text-teal-600 hover:text-teal-800"
        >
          {expanded ? "Show less" : `Show ${rows.length - initialShow} more`}
        </button>
      )}
    </div>
  );
}

type Tab = "countries" | "states" | "cities";

export function LocationsWidget({ data }: { data: LocationsData }) {
  const [tab, setTab] = useState<Tab>("countries");

  const list =
    tab === "countries" ? data.countries : tab === "states" ? data.states : data.cities;
  const hasCountries = data.countries.length > 0;
  const hasStates = data.states.length > 0;
  const hasCities = data.cities.length > 0;

  if (!hasCountries && !hasStates && !hasCities) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
        <p className="text-sm font-medium text-gray-700">Locations</p>
        <p className="mt-2 text-sm text-gray-500">Data not available in this snapshot</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium text-gray-700">Locations</p>
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {hasCountries && (
          <button
            type="button"
            onClick={() => setTab("countries")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === "countries" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Countries
          </button>
        )}
        {hasStates && (
          <button
            type="button"
            onClick={() => setTab("states")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === "states" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            U.S. States
          </button>
        )}
        {hasCities && (
          <button
            type="button"
            onClick={() => setTab("cities")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              tab === "cities" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Cities
          </button>
        )}
      </div>
      <div className="mt-3">
        <LocationList rows={list} initialShow={INITIAL_ROWS} />
      </div>
    </div>
  );
}
