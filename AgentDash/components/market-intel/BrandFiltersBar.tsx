"use client";

import type { BrandFilters, EmployeeBucket, EnrichmentFilter, PlacementSourceFilter, RevenueBucket, VenueRow } from "@/lib/market-intel/queries";
import { DEFAULT_BRAND_FILTERS } from "@/lib/market-intel/queries";
const REVENUE_OPTIONS: {
  value: RevenueBucket;
  label: string;
}[] = [{
  value: "unknown",
  label: "Revenue unknown"
}, {
  value: "under_10m",
  label: "< $10M"
}, {
  value: "10m_50m",
  label: "$10M–50M"
}, {
  value: "50m_250m",
  label: "$50M–250M"
}, {
  value: "250m_1b",
  label: "$250M–1B"
}, {
  value: "over_1b",
  label: "$1B+"
}];
const EMPLOYEE_OPTIONS: {
  value: EmployeeBucket;
  label: string;
}[] = [{
  value: "unknown",
  label: "Employees unknown"
}, {
  value: "under_50",
  label: "< 50"
}, {
  value: "50_200",
  label: "50–200"
}, {
  value: "200_1k",
  label: "200–1K"
}, {
  value: "1k_5k",
  label: "1K–5K"
}, {
  value: "over_5k",
  label: "5K+"
}];
type Props = {
  filters: BrandFilters;
  fundingStages: string[];
  teamOwners: string[];
  venues: VenueRow[];
  sportTypes: string[];
  activeFilterCount: number;
  onChange: (filters: BrandFilters) => void;
};
function toggleValue<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}
export function BrandFiltersBar({
  filters,
  fundingStages,
  teamOwners,
  venues,
  sportTypes,
  activeFilterCount,
  onChange
}: Props) {
  return <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-[#151A17] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[#8E877A]">
          Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
        </p>
        {activeFilterCount > 0 && <button type="button" className="text-xs text-[#CEE4D4] underline" onClick={() => onChange({
        ...DEFAULT_BRAND_FILTERS
      })}>
            Clear all
          </button>}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-[#8E877A]">Firmographics</p>
          <div className="flex flex-wrap gap-2">
            <select value={filters.enrichment} onChange={e => onChange({
            ...filters,
            enrichment: e.target.value as EnrichmentFilter
          })} className="rounded border border-white/10 bg-[#121614] px-2 py-1 text-xs text-[#F4F1EB]">
              <option value="all">All enrichment states</option>
              <option value="enriched">Enriched only</option>
              <option value="not_enriched">Not enriched</option>
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REVENUE_OPTIONS.map(option => <button key={option.value} type="button" className={`rounded-full border px-2 py-0.5 text-[10px] ${filters.revenueBuckets.includes(option.value) ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 text-[#B9B2A6]"}`} onClick={() => onChange({
            ...filters,
            revenueBuckets: toggleValue(filters.revenueBuckets, option.value)
          })}>
                {option.label}
              </button>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EMPLOYEE_OPTIONS.map(option => <button key={option.value} type="button" className={`rounded-full border px-2 py-0.5 text-[10px] ${filters.employeeBuckets.includes(option.value) ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 text-[#B9B2A6]"}`} onClick={() => onChange({
            ...filters,
            employeeBuckets: toggleValue(filters.employeeBuckets, option.value)
          })}>
                {option.label}
              </button>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[{
            value: "has_funding",
            label: "Has funding"
          }, {
            value: "no_funding_data",
            label: "No funding data"
          }, ...fundingStages.map(stage => ({
            value: stage.toLowerCase(),
            label: stage
          }))].map(option => <button key={option.value} type="button" className={`rounded-full border px-2 py-0.5 text-[10px] ${filters.fundingStages.includes(option.value) ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 text-[#B9B2A6]"}`} onClick={() => onChange({
            ...filters,
            fundingStages: toggleValue(filters.fundingStages, option.value)
          })}>
                {option.label}
              </button>)}
          </div>
        </div>

        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-[#8E877A]">Placement</p>
          <div className="flex flex-wrap gap-1.5">
            {([{
            value: "all",
            label: "All sources"
          }, {
            value: "teams_only",
            label: "Teams only"
          }, {
            value: "venues_only",
            label: "Venues only"
          }, {
            value: "both",
            label: "Teams + venues"
          }] as const).map(option => <button key={option.value} type="button" className={`rounded-full border px-2 py-0.5 text-[10px] ${filters.placementSource === option.value ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 text-[#B9B2A6]"}`} onClick={() => onChange({
            ...filters,
            placementSource: option.value as PlacementSourceFilter
          })}>
                {option.label}
              </button>)}
          </div>
          {sportTypes.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
              {sportTypes.map(sport => <button key={sport} type="button" className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${filters.sportTypes.includes(sport) ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 text-[#B9B2A6]"}`} onClick={() => onChange({
            ...filters,
            sportTypes: toggleValue(filters.sportTypes, sport)
          })}>
                  {sport}
                </button>)}
            </div>}
          {teamOwners.length > 0 && <select multiple value={filters.teamOwners} onChange={e => {
          const selected = Array.from(e.target.selectedOptions).map(o => o.value);
          onChange({
            ...filters,
            teamOwners: selected
          });
        }} className="mt-2 max-h-24 w-full rounded border border-white/10 bg-[#121614] px-2 py-1 text-xs text-[#F4F1EB]">
              {teamOwners.map(owner => <option key={owner} value={owner}>
                  {owner}
                </option>)}
            </select>}
          {venues.length > 0 && <select multiple value={filters.venueKeys} onChange={e => {
          const selected = Array.from(e.target.selectedOptions).map(o => o.value);
          onChange({
            ...filters,
            venueKeys: selected
          });
        }} className="mt-2 max-h-24 w-full rounded border border-white/10 bg-[#121614] px-2 py-1 text-xs text-[#F4F1EB]">
              {venues.map(venue => <option key={venue.entity_key} value={venue.entity_key}>
                  {venue.name}
                </option>)}
            </select>}
        </div>
      </div>
    </div>;
}