"use client";

import type {
  BrandFilters,
  EmployeeBucket,
  EnrichmentFilter,
  PlacementCountBucket,
  PlacementSourceFilter,
  RevenueBucket,
  VenueRow,
} from "@/lib/market-intel/queries";
import { DEFAULT_BRAND_FILTERS } from "@/lib/market-intel/queries";

const SELECT_CLASS =
  "rounded-lg border border-white/10 bg-[#121614] px-2 py-1.5 text-xs text-[#F4F1EB] focus:border-[#CEE4D4]/40 focus:outline-none focus:ring-1 focus:ring-[#CEE4D4]/30";

const REVENUE_OPTIONS: { value: RevenueBucket; label: string }[] = [
  { value: "unknown", label: "Revenue unknown" },
  { value: "under_10m", label: "< $10M" },
  { value: "10m_50m", label: "$10M–50M" },
  { value: "50m_250m", label: "$50M–250M" },
  { value: "250m_1b", label: "$250M–1B" },
  { value: "over_1b", label: "$1B+" },
];

const EMPLOYEE_OPTIONS: { value: EmployeeBucket; label: string }[] = [
  { value: "unknown", label: "Employees unknown" },
  { value: "under_50", label: "< 50" },
  { value: "50_200", label: "50–200" },
  { value: "200_1k", label: "200–1K" },
  { value: "1k_5k", label: "1K–5K" },
  { value: "over_5k", label: "5K+" },
];

const PLACEMENT_COUNT_OPTIONS: { value: PlacementCountBucket; label: string }[] = [
  { value: "1", label: "1" },
  { value: "2_3", label: "2–3" },
  { value: "4_9", label: "4–9" },
  { value: "10_plus", label: "10+" },
];

const PLACEMENT_SOURCE_OPTIONS: { value: PlacementSourceFilter; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "teams_only", label: "Teams only" },
  { value: "venues_only", label: "Venues only" },
  { value: "both", label: "Teams + venues" },
];

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
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function labelForRevenue(value: RevenueBucket) {
  return REVENUE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function labelForEmployee(value: EmployeeBucket) {
  return EMPLOYEE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function labelForPlacementCount(value: PlacementCountBucket) {
  return PLACEMENT_COUNT_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function labelForFunding(value: string) {
  if (value === "has_funding") return "Has funding";
  if (value === "no_funding_data") return "No funding data";
  return value;
}

type Chip = {
  key: string;
  label: string;
  onRemove: () => void;
};

function buildActiveChips(
  filters: BrandFilters,
  fundingStages: string[],
  teamOwners: string[],
  venues: VenueRow[],
  onChange: (filters: BrandFilters) => void
): Chip[] {
  const chips: Chip[] = [];

  if (filters.enrichment !== "all") {
    chips.push({
      key: "enrichment",
      label:
        filters.enrichment === "enriched" ? "Enriched only" : "Not enriched",
      onRemove: () => onChange({ ...filters, enrichment: "all" }),
    });
  }

  for (const value of filters.revenueBuckets) {
    chips.push({
      key: `revenue:${value}`,
      label: labelForRevenue(value),
      onRemove: () =>
        onChange({
          ...filters,
          revenueBuckets: filters.revenueBuckets.filter((v) => v !== value),
        }),
    });
  }

  for (const value of filters.employeeBuckets) {
    chips.push({
      key: `employees:${value}`,
      label: labelForEmployee(value),
      onRemove: () =>
        onChange({
          ...filters,
          employeeBuckets: filters.employeeBuckets.filter((v) => v !== value),
        }),
    });
  }

  for (const value of filters.fundingStages) {
    chips.push({
      key: `funding:${value}`,
      label: labelForFunding(value),
      onRemove: () =>
        onChange({
          ...filters,
          fundingStages: filters.fundingStages.filter((v) => v !== value),
        }),
    });
  }

  if (filters.placementSource !== "all") {
    const label =
      PLACEMENT_SOURCE_OPTIONS.find((o) => o.value === filters.placementSource)
        ?.label ?? filters.placementSource;
    chips.push({
      key: "placementSource",
      label,
      onRemove: () => onChange({ ...filters, placementSource: "all" }),
    });
  }

  for (const value of filters.placementCountBuckets) {
    chips.push({
      key: `placements:${value}`,
      label: `${labelForPlacementCount(value)} placements`,
      onRemove: () =>
        onChange({
          ...filters,
          placementCountBuckets: filters.placementCountBuckets.filter(
            (v) => v !== value
          ),
        }),
    });
  }

  for (const value of filters.sportTypes) {
    chips.push({
      key: `sport:${value}`,
      label: value.toUpperCase(),
      onRemove: () =>
        onChange({
          ...filters,
          sportTypes: filters.sportTypes.filter((v) => v !== value),
        }),
    });
  }

  for (const value of filters.teamOwners) {
    chips.push({
      key: `team:${value}`,
      label: value,
      onRemove: () =>
        onChange({
          ...filters,
          teamOwners: filters.teamOwners.filter((v) => v !== value),
        }),
    });
  }

  for (const value of filters.venueKeys) {
    const venue = venues.find((v) => v.entity_key === value);
    chips.push({
      key: `venue:${value}`,
      label: venue?.name ?? value,
      onRemove: () =>
        onChange({
          ...filters,
          venueKeys: filters.venueKeys.filter((v) => v !== value),
        }),
    });
  }

  return chips;
}

export function BrandFiltersBar({
  filters,
  fundingStages,
  teamOwners,
  venues,
  sportTypes,
  activeFilterCount,
  onChange,
}: Props) {
  const chips = buildActiveChips(
    filters,
    fundingStages,
    teamOwners,
    venues,
    onChange
  );

  const fundingOptions = [
    { value: "has_funding", label: "Has funding" },
    { value: "no_funding_data", label: "No funding data" },
    ...fundingStages.map((stage) => ({
      value: stage.toLowerCase(),
      label: stage,
    })),
  ];

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={filters.enrichment}
          onChange={(e) =>
            onChange({
              ...filters,
              enrichment: e.target.value as EnrichmentFilter,
            })
          }
          aria-label="Enrichment state"
          className={SELECT_CLASS}
        >
          <option value="all">Enrichment: any</option>
          <option value="enriched">Enriched</option>
          <option value="not_enriched">Not enriched</option>
        </select>

        <select
          value=""
          onChange={(e) => {
            const value = e.target.value as RevenueBucket;
            if (!value) return;
            onChange({
              ...filters,
              revenueBuckets: toggleValue(filters.revenueBuckets, value),
            });
            e.target.value = "";
          }}
          aria-label="Revenue filter"
          className={SELECT_CLASS}
        >
          <option value="">Revenue…</option>
          {REVENUE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value=""
          onChange={(e) => {
            const value = e.target.value as EmployeeBucket;
            if (!value) return;
            onChange({
              ...filters,
              employeeBuckets: toggleValue(filters.employeeBuckets, value),
            });
            e.target.value = "";
          }}
          aria-label="Employees filter"
          className={SELECT_CLASS}
        >
          <option value="">Employees…</option>
          {EMPLOYEE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value=""
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            onChange({
              ...filters,
              fundingStages: toggleValue(filters.fundingStages, value),
            });
            e.target.value = "";
          }}
          aria-label="Funding filter"
          className={SELECT_CLASS}
        >
          <option value="">Funding…</option>
          {fundingOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={filters.placementSource}
          onChange={(e) =>
            onChange({
              ...filters,
              placementSource: e.target.value as PlacementSourceFilter,
            })
          }
          aria-label="Placement source"
          className={SELECT_CLASS}
        >
          {PLACEMENT_SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Source: {option.label}
            </option>
          ))}
        </select>

        <select
          value=""
          onChange={(e) => {
            const value = e.target.value as PlacementCountBucket;
            if (!value) return;
            onChange({
              ...filters,
              placementCountBuckets: toggleValue(
                filters.placementCountBuckets,
                value
              ),
            });
            e.target.value = "";
          }}
          aria-label="Placement count filter"
          className={SELECT_CLASS}
        >
          <option value="">Placements…</option>
          {PLACEMENT_COUNT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {sportTypes.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              onChange({
                ...filters,
                sportTypes: toggleValue(filters.sportTypes, value),
              });
              e.target.value = "";
            }}
            aria-label="Sport filter"
            className={SELECT_CLASS}
          >
            <option value="">Sport…</option>
            {sportTypes.map((sport) => (
              <option key={sport} value={sport}>
                {sport.toUpperCase()}
              </option>
            ))}
          </select>
        )}

        {teamOwners.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              onChange({
                ...filters,
                teamOwners: toggleValue(filters.teamOwners, value),
              });
              e.target.value = "";
            }}
            aria-label="Team filter"
            className={SELECT_CLASS}
          >
            <option value="">Team…</option>
            {teamOwners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        )}

        {venues.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              onChange({
                ...filters,
                venueKeys: toggleValue(filters.venueKeys, value),
              });
              e.target.value = "";
            }}
            aria-label="Venue filter"
            className={SELECT_CLASS}
          >
            <option value="">Venue…</option>
            {venues.map((venue) => (
              <option key={venue.entity_key} value={venue.entity_key}>
                {venue.name}
              </option>
            ))}
          </select>
        )}

        {activeFilterCount > 0 && (
          <button
            type="button"
            className="text-xs text-[#CEE4D4] underline"
            onClick={() => onChange({ ...DEFAULT_BRAND_FILTERS })}
          >
            Clear all
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-[#2E7040]/40 bg-[#1B2F21] px-2 py-0.5 text-[10px] text-[#DBEEE0]"
              onClick={chip.onRemove}
            >
              {chip.label}
              <span aria-hidden className="text-[#8E877A]">
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
