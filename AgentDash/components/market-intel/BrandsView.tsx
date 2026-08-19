"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ApolloOrgPickerDialog } from "@/components/crm/ApolloOrgPickerDialog";
import {
  FirmographicsCell,
  isFundingNews,
  isHiringOrLayoffNews,
} from "@/components/crm/FirmographicsCell";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { BrandFiltersBar } from "@/components/market-intel/BrandFiltersBar";
import {
  firmographicsFromBrandEnrichment,
  formatMetaAdsDisplay,
  isFirmographicsStale,
} from "@/lib/crm/company-firmographics";
import {
  isTargetListDialogDismissed,
  MARKET_INTEL_CONSULTING_PROFILE_KEY,
  MARKET_INTEL_ENRICH_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";
import { brandToTargetListRow } from "@/lib/market-intel/enrich-brand";
import type {
  AggregatedBrand,
  BrandEnrichmentRow,
  BrandFilters,
  BrandSortKey,
  CupDriverRow,
  TeamSponsorRow,
  VenueRow,
  VenueSponsorRow,
} from "@/lib/market-intel/queries";
import {
  aggregateBrands,
  brandPlacementCount,
  collectFundingStages,
  countActiveBrandFilters,
  countUniqueTeamOwners,
  DEFAULT_BRAND_FILTERS,
  filterBrands,
  hasBrandApolloFirmographics,
  sortBrands,
} from "@/lib/market-intel/queries";

type ConsultingProfile = {
  id: string;
  name: string;
};

type Props = {
  teamSponsors: TeamSponsorRow[];
  venueSponsors: VenueSponsorRow[];
  venues: VenueRow[];
  cupDrivers: CupDriverRow[];
  initialEnrichmentByKey: Record<string, BrandEnrichmentRow>;
  onNavigateToTeam: (ownerName: string) => void;
  onNavigateToVenue: (entityKey: string) => void;
};

type ShowUpInChip =
  | { type: "team"; label: string; ownerName: string }
  | { type: "venue"; label: string; entityKey: string };

const MAX_CHIPS = 3;

const SORT_OPTIONS: { value: BrandSortKey; label: string }[] = [
  { value: "placements-desc", label: "Placements (large → small)" },
  { value: "placements-asc", label: "Placements (small → large)" },
  { value: "brand-asc", label: "Brand (A → Z)" },
  { value: "brand-desc", label: "Brand (Z → A)" },
  { value: "revenue-desc", label: "Revenue (high → low)" },
  { value: "employees-desc", label: "Employees (high → low)" },
  { value: "funding-desc", label: "Funding (high → low)" },
  { value: "growth12-desc", label: "12mo headcount growth" },
];

const actionBtn =
  "rounded border border-white/15 bg-[#1A211D] px-2 py-1 text-xs text-[#CEE4D4] transition hover:bg-[#243028] disabled:cursor-not-allowed disabled:opacity-50";

function showsUpInChips(brand: AggregatedBrand): ShowUpInChip[] {
  const chips: ShowUpInChip[] = [];
  const seen = new Set<string>();

  for (const p of brand.teamPlacements) {
    const key = `team:${p.owner_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ type: "team", label: p.owner_name, ownerName: p.owner_name });
  }

  for (const p of brand.venuePlacements) {
    const key = `venue:${p.entity_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ type: "venue", label: p.venue_name, entityKey: p.entity_key });
  }

  return chips.sort((a, b) => a.label.localeCompare(b.label));
}

function chipKey(chip: ShowUpInChip) {
  return chip.type === "team" ? `team:${chip.ownerName}` : `venue:${chip.entityKey}`;
}

function fmtNewsDate(value: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function PlacementChip({
  chip,
  onNavigateToTeam,
  onNavigateToVenue,
}: {
  chip: ShowUpInChip;
  onNavigateToTeam: (ownerName: string) => void;
  onNavigateToVenue: (entityKey: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (chip.type === "team") onNavigateToTeam(chip.ownerName);
        else onNavigateToVenue(chip.entityKey);
      }}
      className="inline-flex rounded-full border border-white/10 bg-[#121614] px-2 py-0.5 text-xs text-[#CEE4D4] transition hover:border-[#CEE4D4]/40 hover:bg-[#CEE4D4]/10"
    >
      {chip.label}
    </button>
  );
}

function ChipList({
  chips,
  onNavigateToTeam,
  onNavigateToVenue,
}: {
  chips: ShowUpInChip[];
  onNavigateToTeam: (ownerName: string) => void;
  onNavigateToVenue: (entityKey: string) => void;
}) {
  if (chips.length === 0) {
    return <span className="text-[#8E877A]">—</span>;
  }

  const visible = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((chip) => (
        <PlacementChip
          key={chipKey(chip)}
          chip={chip}
          onNavigateToTeam={onNavigateToTeam}
          onNavigateToVenue={onNavigateToVenue}
        />
      ))}
      {overflow > 0 && (
        <span className="inline-flex rounded-full border border-white/10 bg-[#121614] px-2 py-0.5 text-xs text-[#8E877A]">
          +{overflow}
        </span>
      )}
    </div>
  );
}

function PlacementLink({
  label,
  onClick,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-[#F4F1EB] underline decoration-transparent transition hover:text-[#CEE4D4] hover:decoration-[#CEE4D4]/60"
    >
      {label}
    </button>
  );
}

function brandEnrichmentFirmographics(enrichment: BrandEnrichmentRow) {
  return {
    ...firmographicsFromBrandEnrichment(enrichment),
    firmographics_enriched_at: enrichment.enriched_at,
  };
}

function FirmographicsSummary({
  enrichment,
  brandName,
}: {
  enrichment: BrandEnrichmentRow | undefined;
  brandName?: string;
}) {
  if (!hasBrandApolloFirmographics(enrichment)) {
    return <span className="text-xs text-[#8E877A]">Not enriched</span>;
  }

  return (
    <div className="space-y-1">
      <FirmographicsCell
        firmographics={brandEnrichmentFirmographics(enrichment!)}
        compact
        brandName={brandName}
      />
      {isFirmographicsStale(enrichment!.enriched_at, 14) && (
        <p className="text-[10px] text-[#D4C48A]">Stale — consider re-investigating</p>
      )}
    </div>
  );
}

function InstagramCell({ enrichment }: { enrichment: BrandEnrichmentRow | undefined }) {
  const handle = enrichment?.instagram_handle?.trim();
  if (!handle) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }
  const url = handle.startsWith("http")
    ? handle
    : `https://instagram.com/${handle.replace(/^@/, "")}`;
  const label = handle.replace(/^@/, "");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-[#CEE4D4] underline"
      onClick={(e) => e.stopPropagation()}
    >
      @{label}
    </a>
  );
}

function MetaAdsCell({
  enrichment,
  brandName,
}: {
  enrichment: BrandEnrichmentRow | undefined;
  brandName: string;
}) {
  if (!enrichment) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }
  const firmographics = brandEnrichmentFirmographics(enrichment);
  const label = formatMetaAdsDisplay(firmographics, brandName);
  const url = enrichment.meta_ads_library_url;
  if (label && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-[#CEE4D4] underline"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    );
  }
  if (label) {
    return <span className="text-xs text-[#B9B2A6]">{label}</span>;
  }
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-[#CEE4D4] underline"
        onClick={(e) => e.stopPropagation()}
      >
        Ads Library
      </a>
    );
  }
  if (enrichment.meta_ads_status === "not_found") {
    return <span className="text-xs text-[#8E877A]">None found</span>;
  }
  return <span className="text-xs text-[#8E877A]">—</span>;
}

function BrandDetailPanel({
  brand,
  enrichment,
  onNavigateToTeam,
  onNavigateToVenue,
  onStockCorrected,
}: {
  brand: AggregatedBrand;
  enrichment: BrandEnrichmentRow | undefined;
  onNavigateToTeam: (ownerName: string) => void;
  onNavigateToVenue: (entityKey: string) => void;
  onStockCorrected: (brandKey: string, enrichment: BrandEnrichmentRow) => void;
}) {
  return (
    <div className="border-t border-white/10 bg-[#121614] px-4 py-4">
      {enrichment && hasBrandApolloFirmographics(enrichment) && (
        <>
          <div className="mb-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8E877A]">
              Firmographics
            </p>
            <div className="rounded-md border border-white/5 bg-[#151A17] px-3 py-3 text-sm text-[#ECE7DF]">
              <FirmographicsCell
                brandName={brand.displayName}
                firmographics={brandEnrichmentFirmographics(enrichment)}
                stockCorrection={{
                  brandKey: brand.key,
                  companyName: brand.displayName,
                  domain: enrichment.domain,
                  onCorrected: (_firmographics, updatedEnrichment) => {
                    if (updatedEnrichment) {
                      onStockCorrected(brand.key, updatedEnrichment);
                    }
                  },
                }}
              />
              {enrichment.industry && (
                <p className="mt-3 text-xs text-[#8E877A]">
                  Industry: <span className="text-[#ECE7DF]">{enrichment.industry}</span>
                </p>
              )}
              {enrichment.funding_events.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <p className="mb-2 text-xs font-medium text-[#8E877A]">Funding rounds</p>
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-[#8E877A]">
                        <th className="pr-3 pb-1">Date</th>
                        <th className="pr-3 pb-1">Type</th>
                        <th className="pr-3 pb-1">Amount</th>
                        <th className="pb-1">Investors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrichment.funding_events.map((event, idx) => (
                        <tr key={`${event.date ?? ""}-${event.type ?? ""}-${idx}`}>
                          <td className="pr-3 py-1">{event.date ?? "—"}</td>
                          <td className="pr-3 py-1">{event.type ?? "—"}</td>
                          <td className="pr-3 py-1">{event.amount ?? "—"}</td>
                          <td className="py-1">{event.investors ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {enrichment.news_articles.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8E877A]">
                Recent news
              </p>
              <ul className="space-y-2">
                {enrichment.news_articles.map((article) => {
                  const highlight =
                    isHiringOrLayoffNews(article.event_categories) ||
                    isFundingNews(article.event_categories);
                  return (
                  <li
                    key={article.id}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      highlight
                        ? "border-[#2E7040]/40 bg-[#1B2F21]"
                        : "border-white/5 bg-[#151A17]"
                    }`}
                  >
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-[#CEE4D4] underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {article.title}
                    </a>
                    {article.published_at && (
                      <p className="mt-0.5 text-xs text-[#8E877A]">
                        {fmtNewsDate(article.published_at)}
                      </p>
                    )}
                    {article.snippet && (
                      <p className="mt-1 text-xs text-[#B9B2A6]">{article.snippet}</p>
                    )}
                    {article.event_categories.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {article.event_categories.map((cat) => (
                          <span
                            key={cat}
                            className="rounded-full border border-white/10 bg-[#121614] px-2 py-0.5 text-[10px] text-[#B9B2A6]"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {brand.teamPlacements.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8E877A]">
            Team placements
          </p>
          <ul className="space-y-2 text-sm text-[#ECE7DF]">
            {brand.teamPlacements.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/5 bg-[#151A17] px-3 py-2"
              >
                <div>
                  <PlacementLink
                    label={p.owner_name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToTeam(p.owner_name);
                    }}
                  />
                  {p.team_name && p.team_name !== p.owner_name && (
                    <span className="text-[#8E877A]"> · {p.team_name}</span>
                  )}
                </div>
                {p.sponsor_url ? (
                  <a
                    href={p.sponsor_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#CEE4D4] underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    sponsor site
                  </a>
                ) : (
                  <span className="text-xs text-[#8E877A]">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brand.venuePlacements.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8E877A]">
            Venue placements
          </p>
          <ul className="space-y-2 text-sm text-[#ECE7DF]">
            {brand.venuePlacements.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/5 bg-[#151A17] px-3 py-2"
              >
                <PlacementLink
                  label={p.venue_name}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToVenue(p.entity_key);
                  }}
                />
                {p.sponsor_url ? (
                  <a
                    href={p.sponsor_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#CEE4D4] underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    sponsor site
                  </a>
                ) : (
                  <span className="text-xs text-[#8E877A]">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BrandsView({
  teamSponsors,
  venueSponsors,
  venues,
  cupDrivers,
  initialEnrichmentByKey,
  onNavigateToTeam,
  onNavigateToVenue,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BrandSortKey>("placements-desc");
  const [filters, setFilters] = useState<BrandFilters>(DEFAULT_BRAND_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [enrichmentByKey, setEnrichmentByKey] = useState(initialEnrichmentByKey);
  const [consultingProfiles, setConsultingProfiles] = useState<ConsultingProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [enrichingKeys, setEnrichingKeys] = useState<Set<string>>(new Set());
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"enrich" | "add" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [enrichConfirmOpen, setEnrichConfirmOpen] = useState(false);
  const [pendingEnrichKeys, setPendingEnrichKeys] = useState<string[]>([]);
  const [orgPickerBrand, setOrgPickerBrand] = useState<AggregatedBrand | null>(null);
  const [pendingOrgEnrichKeys, setPendingOrgEnrichKeys] = useState<string[]>([]);

  const handleStockCorrected = useCallback((brandKey: string, enrichment: BrandEnrichmentRow) => {
    setEnrichmentByKey((prev) => ({
      ...prev,
      [brandKey]: enrichment,
    }));
  }, []);

  useEffect(() => {
    setEnrichmentByKey(initialEnrichmentByKey);
  }, [initialEnrichmentByKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/consulting/profiles", { credentials: "include" });
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const profiles = (data.profiles ?? []) as ConsultingProfile[];
        setConsultingProfiles(profiles);
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(MARKET_INTEL_CONSULTING_PROFILE_KEY)
            : null;
        if (stored && profiles.some((p) => p.id === stored)) {
          setSelectedProfileId(stored);
        } else if (profiles.length === 1) {
          setSelectedProfileId(profiles[0].id);
        }
      } catch {
        // ignore — consulting actions stay hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProfileChange = (profileId: string) => {
    setSelectedProfileId(profileId);
    try {
      if (profileId) {
        window.localStorage.setItem(MARKET_INTEL_CONSULTING_PROFILE_KEY, profileId);
      } else {
        window.localStorage.removeItem(MARKET_INTEL_CONSULTING_PROFILE_KEY);
      }
    } catch {
      // ignore
    }
  };

  const allBrands = useMemo(
    () => aggregateBrands(teamSponsors, venueSponsors),
    [teamSponsors, venueSponsors]
  );

  const venueSportByKey = useMemo(
    () => new Map(venues.map((v) => [v.entity_key, v.sport_type])),
    [venues]
  );

  const teamOwners = useMemo(
    () => [...new Set(teamSponsors.map((row) => row.owner_name))].sort((a, b) => a.localeCompare(b)),
    [teamSponsors]
  );

  const sportTypes = useMemo(() => {
    const sports = new Set<string>();
    if (teamSponsors.length > 0) sports.add("nascar");
    for (const venue of venues) {
      if (venue.sport_type) sports.add(venue.sport_type.toLowerCase());
    }
    return [...sports].sort();
  }, [teamSponsors.length, venues]);

  const fundingStages = useMemo(
    () => collectFundingStages(enrichmentByKey),
    [enrichmentByKey]
  );

  const filteredBrands = useMemo(
    () =>
      sortBrands(
        filterBrands(allBrands, search, cupDrivers, filters, enrichmentByKey, venueSportByKey),
        sort,
        enrichmentByKey
      ),
    [allBrands, search, cupDrivers, filters, enrichmentByKey, venueSportByKey, sort]
  );

  const activeFilterCount = useMemo(() => countActiveBrandFilters(filters), [filters]);

  const stats = useMemo(
    () => ({
      brands: allBrands.length,
      teams: countUniqueTeamOwners(teamSponsors),
      venues: venues.length,
    }),
    [allBrands.length, teamSponsors, venues.length]
  );

  const searching = search.trim().length > 0 || activeFilterCount > 0;
  const hasConsultingProfiles = consultingProfiles.length > 0;

  const runEnrich = useCallback(async (keys: string[], apollo_organization_id?: string) => {
    if (keys.length === 0) return;
    setStatusMessage(null);
    setEnrichingKeys(new Set(keys));
    if (keys.length > 1) setBulkBusy("enrich");

    try {
      const res = await fetch("/api/market-intel/brands/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          brand_keys: keys,
          apollo_organization_id,
          force: Boolean(apollo_organization_id),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Enrich failed");

      const results = (data.results ?? []) as Array<{
        key: string;
        ok: boolean;
        needsConfirmation?: boolean;
        match_notes?: string | null;
        enrichment?: BrandEnrichmentRow;
        error?: string;
      }>;

      const needsConfirm = results.filter((r) => r.needsConfirmation);
      if (needsConfirm.length > 0 && !apollo_organization_id) {
        const brand = allBrands.find((b) => b.key === needsConfirm[0].key);
        if (brand) {
          setPendingOrgEnrichKeys(keys);
          setOrgPickerBrand(brand);
          setStatusMessage(needsConfirm[0].match_notes ?? "Confirm the correct Apollo company.");
          return;
        }
      }

      setEnrichmentByKey((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.ok && result.enrichment) {
            next[result.key] = result.enrichment;
          }
        }
        return next;
      });

      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount - needsConfirm.length;
      if (failCount === 0) {
        setStatusMessage(
          keys.length === 1
            ? `Enriched ${keys.length} brand.`
            : `Enriched ${okCount} brands.`
        );
      } else {
        const firstErr = results.find((r) => !r.ok && !r.needsConfirmation)?.error;
        setStatusMessage(
          `Enriched ${okCount}; ${failCount} failed${firstErr ? `: ${firstErr}` : ""}.`
        );
      }
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : "Enrich failed");
    } finally {
      setEnrichingKeys(new Set());
      setBulkBusy(null);
    }
  }, [allBrands]);

  function requestEnrich(keys: string[]) {
    if (keys.length === 0 || enrichingKeys.size > 0 || bulkBusy) return;
    if (isTargetListDialogDismissed(MARKET_INTEL_ENRICH_DISMISS_KEY)) {
      void runEnrich(keys);
      return;
    }
    setPendingEnrichKeys(keys);
    setEnrichConfirmOpen(true);
  }

  const addBrandsToList = useCallback(
    async (brands: AggregatedBrand[]) => {
      if (!selectedProfileId || brands.length === 0) return;
      setStatusMessage(null);
      setAddingKeys(new Set(brands.map((b) => b.key)));
      if (brands.length > 1) setBulkBusy("add");

      try {
        const companies = brands.map((b) => brandToTargetListRow(b, enrichmentByKey[b.key]));
        const res = await fetch(`/api/consulting/profiles/${selectedProfileId}/target-list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            companies.length === 1 ? companies[0] : { companies }
          ),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Add to list failed");

        if (brands.length === 1) {
          setStatusMessage(`Added ${brands[0].displayName} to target list.`);
        } else {
          setStatusMessage(
            `Added ${data.added ?? companies.length} companies to target list.`
          );
        }
      } catch (e) {
        setStatusMessage(e instanceof Error ? e.message : "Add to list failed");
      } finally {
        setAddingKeys(new Set());
        setBulkBusy(null);
      }
    },
    [selectedProfileId, enrichmentByKey]
  );

  const enrichBusy = enrichingKeys.size > 0 || bulkBusy === "enrich";
  const addBusy = addingKeys.size > 0 || bulkBusy === "add";

  return (
    <section className="space-y-4">
      <ApolloOrgPickerDialog
        open={orgPickerBrand != null}
        brandKey={orgPickerBrand?.key}
        companyName={orgPickerBrand?.displayName}
        onClose={() => {
          setOrgPickerBrand(null);
          setPendingOrgEnrichKeys([]);
        }}
        onSelected={({ apollo_organization_id }) => {
          const keys =
            pendingOrgEnrichKeys.length > 0
              ? pendingOrgEnrichKeys
              : orgPickerBrand
                ? [orgPickerBrand.key]
                : [];
          setOrgPickerBrand(null);
          setPendingOrgEnrichKeys([]);
          void runEnrich(keys, apollo_organization_id);
        }}
      />

      <TargetListActionDialog
        open={enrichConfirmOpen}
        title="Enrich brands via Apollo?"
        description={
          <>
            <p>
              Enriching uses up to <span className="font-medium text-[#E6E0D5]">3 Apollo credits</span>{" "}
              per brand (organization enrich, organization detail, and news search).
            </p>
            <p className="mt-2">
              {pendingEnrichKeys.length === 1
                ? "Continue for this brand?"
                : `Continue for ${pendingEnrichKeys.length} visible brands?`}
            </p>
          </>
        }
        confirmLabel="Enrich"
        dismissStorageKey={MARKET_INTEL_ENRICH_DISMISS_KEY}
        onConfirm={() => {
          setEnrichConfirmOpen(false);
          void runEnrich(pendingEnrichKeys);
          setPendingEnrichKeys([]);
        }}
        onCancel={() => {
          setEnrichConfirmOpen(false);
          setPendingEnrichKeys([]);
        }}
      />

      <div className="sticky top-0 z-10 -mx-4 border-b border-white/10 bg-[#121614]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setExpandedKey(null);
            }}
            placeholder="Search brands, teams, venues, or drivers…"
            className="w-full flex-1 rounded-lg border border-white/10 bg-[#151A17] px-4 py-2.5 text-sm text-[#F4F1EB] placeholder:text-[#8E877A] focus:border-[#CEE4D4]/40 focus:outline-none focus:ring-1 focus:ring-[#CEE4D4]/30"
          />
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as BrandSortKey);
              setExpandedKey(null);
            }}
            aria-label="Sort brands"
            className="w-full shrink-0 rounded-lg border border-white/10 bg-[#151A17] px-3 py-2.5 text-sm text-[#F4F1EB] focus:border-[#CEE4D4]/40 focus:outline-none focus:ring-1 focus:ring-[#CEE4D4]/30 sm:w-auto"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-[#151A17] px-3 py-2.5 text-sm text-[#CEE4D4]"
            onClick={() => setShowFilters((open) => !open)}
          >
            {showFilters ? "Hide filters" : "Show filters"}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>

        {showFilters && (
          <BrandFiltersBar
            filters={filters}
            fundingStages={fundingStages}
            teamOwners={teamOwners}
            venues={venues}
            sportTypes={sportTypes}
            activeFilterCount={activeFilterCount}
            onChange={(next) => {
              setFilters(next);
              setExpandedKey(null);
            }}
          />
        )}

        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {hasConsultingProfiles ? (
            <select
              value={selectedProfileId}
              onChange={(e) => handleProfileChange(e.target.value)}
              aria-label="Consulting profile"
              className="w-full rounded-lg border border-white/10 bg-[#151A17] px-3 py-2 text-sm text-[#F4F1EB] sm:w-auto"
            >
              <option value="">Consulting profile…</option>
              {consultingProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-[#8E877A]">
              No consulting profiles — add-to-list actions are hidden.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionBtn}
              disabled={enrichBusy || filteredBrands.length === 0}
              onClick={() => requestEnrich(filteredBrands.map((b) => b.key))}
            >
              {bulkBusy === "enrich"
                ? "Enriching…"
                : `Enrich visible (${filteredBrands.length})`}
            </button>
            {hasConsultingProfiles && (
              <button
                type="button"
                className={actionBtn}
                disabled={!selectedProfileId || addBusy || filteredBrands.length === 0}
                onClick={() => void addBrandsToList(filteredBrands)}
              >
                {bulkBusy === "add"
                  ? "Adding…"
                  : `Add visible to list (${filteredBrands.length})`}
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-xs text-[#8E877A]">
          {stats.brands} brands · {stats.teams} teams · {stats.venues} venues
          {searching && (
            <span className="text-[#B9B2A6]">
              {" "}
              · showing {filteredBrands.length} match
              {filteredBrands.length === 1 ? "" : "es"}
            </span>
          )}
        </p>
        {statusMessage && (
          <p className="mt-1 text-xs text-[#CEE4D4]" role="status">
            {statusMessage}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-[#151A17] shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-[#121614] text-left text-xs uppercase tracking-wide text-[#8E877A]">
              <tr>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Placements</th>
                <th className="px-4 py-3">Instagram</th>
                <th className="px-4 py-3">Meta ads</th>
                <th className="px-4 py-3">Firmographics</th>
                <th className="px-4 py-3">Shows up in</th>
                <th className="px-4 py-3">Actions</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-[#ECE7DF]">
              {filteredBrands.map((brand) => {
                const open = expandedKey === brand.key;
                const count = brandPlacementCount(brand);
                const chips = showsUpInChips(brand);
                const enrichment = enrichmentByKey[brand.key];
                const isEnriching = enrichingKeys.has(brand.key);
                const isAdding = addingKeys.has(brand.key);
                return (
                  <Fragment key={brand.key}>
                    <tr
                      className="cursor-pointer hover:bg-white/5"
                      onClick={() => setExpandedKey(open ? null : brand.key)}
                    >
                      <td className="px-4 py-3 font-medium text-[#F4F1EB]">
                        {brand.displayName}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[#B9B2A6]">{count}</td>
                      <td className="px-4 py-3">
                        <InstagramCell enrichment={enrichment} />
                      </td>
                      <td className="px-4 py-3">
                        <MetaAdsCell enrichment={enrichment} brandName={brand.displayName} />
                      </td>
                      <td className="px-4 py-3">
                        <FirmographicsSummary enrichment={enrichment} brandName={brand.displayName} />
                      </td>
                      <td className="px-4 py-3">
                        <ChipList
                          chips={chips}
                          onNavigateToTeam={onNavigateToTeam}
                          onNavigateToVenue={onNavigateToVenue}
                        />
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className={actionBtn}
                            disabled={isEnriching || enrichBusy}
                            onClick={() => requestEnrich([brand.key])}
                          >
                            {isEnriching ? "Investigating…" : "Investigate"}
                          </button>
                          <button
                            type="button"
                            className={actionBtn}
                            disabled={isEnriching || enrichBusy}
                            onClick={() => {
                              setOrgPickerBrand(brand);
                              setPendingOrgEnrichKeys([brand.key]);
                            }}
                          >
                            Wrong company?
                          </button>
                          {hasConsultingProfiles && (
                            <button
                              type="button"
                              className={actionBtn}
                              disabled={!selectedProfileId || isAdding || addBusy}
                              onClick={() => void addBrandsToList([brand])}
                            >
                              {isAdding ? "Adding…" : "Add to list"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#8E877A]">{open ? "−" : "+"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <BrandDetailPanel
                            brand={brand}
                            enrichment={enrichment}
                            onNavigateToTeam={onNavigateToTeam}
                            onNavigateToVenue={onNavigateToVenue}
                            onStockCorrected={handleStockCorrected}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredBrands.length === 0 && (
          <p className="p-6 text-sm text-[#B9B2A6]">
            {searching
              ? "No brands match your search."
              : "No sponsor data synced yet. Run the market sponsor scraper sync job."}
          </p>
        )}
      </div>
    </section>
  );
}
