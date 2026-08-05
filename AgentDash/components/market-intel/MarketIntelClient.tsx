"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandsView } from "@/components/market-intel/BrandsView";
import type {
  BrandEnrichmentRow,
  CupDriverRow,
  TeamSponsorRow,
  VenueRow,
  VenueSponsorRow,
} from "@/lib/market-intel/queries";
import {
  groupTeamSponsorsByOwner,
  groupVenueSponsorsByVenue,
} from "@/lib/market-intel/queries";

type Tab = "brands" | "cup" | "teams" | "venues" | "motogp" | "f1" | "score";

type FocusTarget =
  | { type: "team"; ownerName: string }
  | { type: "venue"; entityKey: string };

type Props = {
  cupDrivers: CupDriverRow[];
  teamSponsors: TeamSponsorRow[];
  venues: VenueRow[];
  venueSponsors: VenueSponsorRow[];
  enrichmentByKey: Record<string, BrandEnrichmentRow>;
  lastSyncAt: string | null;
};

function fmtDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function teamFocusId(ownerName: string) {
  return `market-intel-team-${encodeURIComponent(ownerName)}`;
}

function venueFocusId(entityKey: string) {
  return `market-intel-venue-${entityKey}`;
}

function sportKey(sportType: string | null | undefined) {
  return (sportType || "").trim().toLowerCase();
}

function isMotoGpSport(sportType: string | null | undefined) {
  return sportKey(sportType) === "motogp";
}

function isF1Sport(sportType: string | null | undefined) {
  return sportKey(sportType) === "f1";
}

function isScoreSport(sportType: string | null | undefined) {
  return sportKey(sportType) === "score";
}

function tabForVenueSport(sportType: string | null | undefined): Tab {
  if (isMotoGpSport(sportType)) return "motogp";
  if (isF1Sport(sportType)) return "f1";
  if (isScoreSport(sportType)) return "score";
  return "venues";
}

function VenueAccordionList({
  venues,
  sponsorsByVenue,
  expandedVenue,
  setExpandedVenue,
  focusTarget,
  emptyMessage,
}: {
  venues: VenueRow[];
  sponsorsByVenue: Map<string, VenueSponsorRow[]>;
  expandedVenue: string | null;
  setExpandedVenue: (key: string | null) => void;
  focusTarget: FocusTarget | null;
  emptyMessage: string;
}) {
  return (
    <section className="space-y-3">
      {venues.map((venue) => {
        const sponsors = sponsorsByVenue.get(venue.entity_key) ?? [];
        const open = expandedVenue === venue.entity_key;
        const focused =
          focusTarget?.type === "venue" && focusTarget.entityKey === venue.entity_key;
        return (
          <div
            key={venue.entity_key}
            id={venueFocusId(venue.entity_key)}
            className={`rounded-lg border bg-[#151A17] shadow transition ${
              focused
                ? "border-[#CEE4D4]/50 ring-2 ring-[#CEE4D4]/40"
                : "border-white/10"
            }`}
          >
            <button
              type="button"
              onClick={() => setExpandedVenue(open ? null : venue.entity_key)}
              className={`flex w-full items-center justify-between px-4 py-3 text-left ${
                focused ? "bg-[#CEE4D4]/10" : ""
              }`}
            >
              <div>
                <p className="font-medium text-[#F4F1EB]">{venue.name}</p>
                <p className="text-xs text-[#8E877A]">
                  {venue.sport_type || "venue"} · {sponsors.length} sponsors ·{" "}
                  <a
                    href={venue.sponsor_page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    source
                  </a>
                </p>
              </div>
              <span className="text-[#B9B2A6]">{open ? "−" : "+"}</span>
            </button>
            {open && (
              <ul className="border-t border-white/10 px-4 py-3 text-sm text-[#ECE7DF]">
                {sponsors.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-1">
                    <span>{s.company_name}</span>
                    {s.sponsor_url ? (
                      <a
                        href={s.sponsor_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#CEE4D4] underline"
                      >
                        site
                      </a>
                    ) : (
                      <span className="text-xs text-[#8E877A]">—</span>
                    )}
                  </li>
                ))}
                {sponsors.length === 0 && (
                  <li className="text-[#B9B2A6]">No sponsors scraped yet.</li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {venues.length === 0 && <p className="text-sm text-[#B9B2A6]">{emptyMessage}</p>}
    </section>
  );
}

export function MarketIntelClient({
  cupDrivers,
  teamSponsors,
  venues,
  venueSponsors,
  enrichmentByKey,
  lastSyncAt,
}: Props) {
  const [tab, setTab] = useState<Tab>("brands");
  const [expandedOwner, setExpandedOwner] = useState<string | null>(null);
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const sponsorsByOwner = useMemo(
    () => groupTeamSponsorsByOwner(teamSponsors),
    [teamSponsors]
  );
  const sponsorsByVenue = useMemo(
    () => groupVenueSponsorsByVenue(venueSponsors),
    [venueSponsors]
  );

  const uniqueOwners = useMemo(() => {
    const owners = new Map<string, CupDriverRow>();
    for (const row of cupDrivers) {
      const key = row.owner_name?.trim();
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, row);
    }
    return [...owners.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cupDrivers]);

  const stadiumVenues = useMemo(
    () =>
      venues.filter(
        (v) =>
          !isMotoGpSport(v.sport_type) &&
          !isF1Sport(v.sport_type) &&
          !isScoreSport(v.sport_type)
      ),
    [venues]
  );
  const motoGpVenues = useMemo(
    () => venues.filter((v) => isMotoGpSport(v.sport_type)),
    [venues]
  );
  const f1Venues = useMemo(
    () => venues.filter((v) => isF1Sport(v.sport_type)),
    [venues]
  );
  const scoreVenues = useMemo(
    () => venues.filter((v) => isScoreSport(v.sport_type)),
    [venues]
  );

  const venueByKey = useMemo(() => {
    const map = new Map<string, VenueRow>();
    for (const venue of venues) map.set(venue.entity_key, venue);
    return map;
  }, [venues]);

  const navigateToTeam = (ownerName: string) => {
    setTab("teams");
    setExpandedOwner(ownerName);
    setExpandedVenue(null);
    setFocusTarget({ type: "team", ownerName });
  };

  const navigateToVenue = (entityKey: string) => {
    const venue = venueByKey.get(entityKey);
    setTab(tabForVenueSport(venue?.sport_type));
    setExpandedVenue(entityKey);
    setExpandedOwner(null);
    setFocusTarget({ type: "venue", entityKey });
  };

  useEffect(() => {
    if (!focusTarget) return;

    const scrollTimer = window.setTimeout(() => {
      const id =
        focusTarget.type === "team"
          ? teamFocusId(focusTarget.ownerName)
          : venueFocusId(focusTarget.entityKey);
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);

    const clearTimer = window.setTimeout(() => setFocusTarget(null), 4000);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [focusTarget, tab, expandedOwner, expandedVenue]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "brands", label: "Brands" },
    { id: "cup", label: "Cup Series" },
    { id: "teams", label: "NASCAR" },
    { id: "venues", label: "Stadiums" },
    { id: "motogp", label: "MotoGP" },
    { id: "f1", label: "Formula 1" },
    { id: "score", label: "SCORE" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-lg border border-white/10 bg-[#151A17] p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                tab === item.id
                  ? "bg-white/10 text-[#F4F1EB]"
                  : "text-[#B9B2A6] hover:text-[#ECE7DF]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-[#8E877A]">Last sync: {fmtDate(lastSyncAt)}</p>
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => {
              setSyncBusy(true);
              setSyncMessage(null);
              void (async () => {
                try {
                  const res = await fetch("/api/market-intel/sync", {
                    method: "POST",
                    credentials: "include",
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    throw new Error(data?.error || "Sync failed");
                  }
                  setSyncMessage(
                    data.message ?? "Scrape started — refresh in a few minutes."
                  );
                } catch (e) {
                  setSyncMessage(e instanceof Error ? e.message : "Sync failed");
                } finally {
                  setSyncBusy(false);
                }
              })();
            }}
            className="rounded-md border border-white/10 bg-[#151A17] px-2.5 py-1 text-xs text-[#CEE4D4] transition hover:bg-[#1A211D] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncBusy ? "Starting…" : "Sync"}
          </button>
          {syncMessage && (
            <p className="text-xs text-[#CEE4D4]" role="status">
              {syncMessage}
            </p>
          )}
        </div>
      </div>

      {tab === "brands" && (
        <BrandsView
          teamSponsors={teamSponsors}
          venueSponsors={venueSponsors}
          venues={venues}
          cupDrivers={cupDrivers}
          initialEnrichmentByKey={enrichmentByKey}
          onNavigateToTeam={navigateToTeam}
          onNavigateToVenue={navigateToVenue}
        />
      )}

      {tab === "cup" && (
        <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151A17] shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-[#121614] text-left text-xs uppercase tracking-wide text-[#8E877A]">
                <tr>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Mfr</th>
                  <th className="px-4 py-3">Points</th>
                  <th className="px-4 py-3">Wins</th>
                  <th className="px-4 py-3">Top 10</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-[#ECE7DF]">
                {cupDrivers.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="px-4 py-2">{row.position ?? "—"}</td>
                    <td className="px-4 py-2">{row.car_no}</td>
                    <td className="px-4 py-2 font-medium">{row.driver_name}</td>
                    <td className="px-4 py-2">{row.owner_name ?? "—"}</td>
                    <td className="px-4 py-2">{row.manufacturer ?? "—"}</td>
                    <td className="px-4 py-2">{row.points ?? "—"}</td>
                    <td className="px-4 py-2">{row.wins ?? "—"}</td>
                    <td className="px-4 py-2">{row.top_10 ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cupDrivers.length === 0 && (
            <p className="p-6 text-sm text-[#B9B2A6]">
              No Cup standings synced yet. Run the market sponsor scraper sync job.
            </p>
          )}
        </section>
      )}

      {tab === "teams" && (
        <section className="space-y-3">
          {uniqueOwners.map(([ownerName, sample]) => {
            const sponsors = sponsorsByOwner.get(ownerName) ?? [];
            const open = expandedOwner === ownerName;
            const focused =
              focusTarget?.type === "team" && focusTarget.ownerName === ownerName;
            return (
              <div
                key={ownerName}
                id={teamFocusId(ownerName)}
                className={`rounded-lg border bg-[#151A17] shadow transition ${
                  focused
                    ? "border-[#CEE4D4]/50 ring-2 ring-[#CEE4D4]/40"
                    : "border-white/10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedOwner(open ? null : ownerName)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left ${
                    focused ? "bg-[#CEE4D4]/10" : ""
                  }`}
                >
                  <div>
                    <p className="font-medium text-[#F4F1EB]">{ownerName}</p>
                    <p className="text-xs text-[#8E877A]">
                      {sponsors.length} sponsors
                      {sample.team_website_url ? (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={sample.team_website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            team site
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className="text-[#B9B2A6]">{open ? "−" : "+"}</span>
                </button>
                {open && (
                  <ul className="border-t border-white/10 px-4 py-3 text-sm text-[#ECE7DF]">
                    {sponsors.map((s) => (
                      <li key={s.id} className="flex items-center justify-between py-1">
                        <span>{s.company_name}</span>
                        {s.sponsor_url ? (
                          <a
                            href={s.sponsor_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[#CEE4D4] underline"
                          >
                            site
                          </a>
                        ) : (
                          <span className="text-xs text-[#8E877A]">—</span>
                        )}
                      </li>
                    ))}
                    {sponsors.length === 0 && (
                      <li className="text-[#B9B2A6]">No sponsors scraped yet.</li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
          {uniqueOwners.length === 0 && (
            <p className="text-sm text-[#B9B2A6]">No team sponsor data synced yet.</p>
          )}
        </section>
      )}

      {tab === "venues" && (
        <VenueAccordionList
          venues={stadiumVenues}
          sponsorsByVenue={sponsorsByVenue}
          expandedVenue={expandedVenue}
          setExpandedVenue={setExpandedVenue}
          focusTarget={focusTarget}
          emptyMessage="No stadiums configured or synced yet."
        />
      )}

      {tab === "motogp" && (
        <VenueAccordionList
          venues={motoGpVenues}
          sponsorsByVenue={sponsorsByVenue}
          expandedVenue={expandedVenue}
          setExpandedVenue={setExpandedVenue}
          focusTarget={focusTarget}
          emptyMessage="No MotoGP teams synced yet. Scrape venues with sport_type motogp, then run sync."
        />
      )}

      {tab === "f1" && (
        <VenueAccordionList
          venues={f1Venues}
          sponsorsByVenue={sponsorsByVenue}
          expandedVenue={expandedVenue}
          setExpandedVenue={setExpandedVenue}
          focusTarget={focusTarget}
          emptyMessage="No Formula 1 teams synced yet. Scrape venues with sport_type f1, then run sync."
        />
      )}

      {tab === "score" && (
        <VenueAccordionList
          venues={scoreVenues}
          sponsorsByVenue={sponsorsByVenue}
          expandedVenue={expandedVenue}
          setExpandedVenue={setExpandedVenue}
          focusTarget={focusTarget}
          emptyMessage="No SCORE teams synced yet. Scrape venues with sport_type score, then run sync."
        />
      )}
    </div>
  );
}
