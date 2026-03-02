"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CreatorIQSnapshot } from "@/lib/supabase/types";
import type { AudienceMetricsResult } from "@/lib/audience-metrics";
import {
  coerceJson,
  parseAccounts,
  getTotals,
  getPrimaryAccount,
  getAudienceForAccount,
  getAudienceRoot,
  getAudienceNodes,
  parseInterestsFromAudience,
  parseBrandsFromAudience,
  parseLocationsFromAudience,
  isSnapshotStale,
} from "@/lib/ciq/overview";
import { OverviewSummaryCard } from "./OverviewSummaryCard";
import { AccountCard } from "./AccountCard";
import { AudiencePerAccount } from "./AudiencePerAccount";
import { InterestsBrands } from "./InterestsBrands";
import { LocationsWidget } from "./LocationsWidget";

type Props = {
  athleteId: string;
  creatoriqId: string | null;
  snapshots: CreatorIQSnapshot[];
  audienceMetrics?: AudienceMetricsResult | null;
  canRefresh: boolean;
};

export function Overview({ athleteId, creatoriqId, snapshots, audienceMetrics, canRefresh }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const accountsSnapshot = snapshots.find((s) => s.snapshot_type === "accounts");
  const audienceSnapshot = snapshots.find((s) => s.snapshot_type === "audience");

  const accountsRaw = accountsSnapshot?.raw_json ?? null;
  const audienceRaw = audienceSnapshot?.raw_json ?? null;

  const accounts = parseAccounts(accountsRaw);
  const totals = getTotals(accounts);
  const primary = getPrimaryAccount(accounts);

  const audienceNodes = getAudienceNodes(audienceRaw);
  const audienceByAccount = accounts.map((acc) => getAudienceForAccount(acc, audienceRaw, primary));
  const matchCount = audienceByAccount.filter(Boolean).length;

  // TEMP DEBUG: remove this block once matches > 0 and audience charts render correctly
  if (typeof window !== "undefined") {
    console.log("[Overview] parsedAccounts", accounts.map((a) => ({ network: a.network, socialNetworkId: a.socialNetworkId })));
    console.log(
      "[Overview] parsedAudienceNodes",
      audienceNodes.map((n) => {
        const demo = (n.Demographics ?? n.demographics) as Record<string, unknown> | undefined;
        return { demographics: { network: demo?.Network ?? demo?.network, socialNetworkId: demo?.SocialNetworkId ?? demo?.social_network_id } };
      })
    );
    console.log("[Overview] number of matches found", matchCount);
  }

  const latestFetchedAt = accountsSnapshot?.fetched_at ?? audienceSnapshot?.fetched_at ?? audienceMetrics?.fetchedAt;
  const stale = latestFetchedAt ? isSnapshotStale(latestFetchedAt) : false;

  const audienceObj =
    audienceRaw != null ? (coerceJson(audienceRaw) as Record<string, unknown> | null) : null;
  const audienceRoot = audienceObj ? getAudienceRoot(audienceObj) : {};
  const fromCiqInterests = audienceSnapshot ? parseInterestsFromAudience(audienceRoot) : [];
  const fromCiqBrands = audienceSnapshot ? parseBrandsFromAudience(audienceRoot) : [];
  const fromCiqLocations = audienceSnapshot && audienceObj
    ? parseLocationsFromAudience(audienceObj)
    : { countries: [] as { name: string; value: number }[], states: [] as { name: string; value: number }[], cities: [] as { name: string; value: number }[] };
  const summary = audienceMetrics?.summary;
  const interests = (summary?.interests?.length ? summary.interests : fromCiqInterests);
  const brands = (summary?.brands?.length ? summary.brands : fromCiqBrands);
  const locations = summary && (summary.countries?.length || summary.states?.length || summary.cities?.length)
    ? { countries: summary.countries ?? [], states: summary.states ?? [], cities: summary.cities ?? [] }
    : fromCiqLocations;

  async function handleRefresh() {
    if (!creatoriqId || !canRefresh) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/ciq/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athlete_id: athleteId, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.errors?.length) {
          alert(`Saved ${data.snapshots_created ?? 0} snapshot(s). Some endpoints failed:\n${data.errors.join("\n")}`);
        }
        router.refresh();
      } else {
        alert(data.error || "Failed to refresh");
      }
    } finally {
      setRefreshing(false);
    }
  }

  const hasManualAudience = summary && (
    summary.gender?.length || summary.age?.length || summary.countries?.length ||
    summary.states?.length || summary.cities?.length || summary.interests?.length || summary.brands?.length
  );

  if (!creatoriqId && !hasManualAudience) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">Overview</h2>
        <p className="text-sm text-gray-500">
          Set the CreatorIQ Creator ID in Basic Information above to see overview data, or use Admin → Manual Audience to enter metrics.
        </p>
      </section>
    );
  }

  const hasSnapshots = accountsSnapshot || audienceSnapshot;
  const hasAnyData = hasSnapshots || hasManualAudience;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium text-gray-900">Overview</h2>
          {audienceMetrics?.source === "manual" && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              Audience: manual
            </span>
          )}
          {stale && hasSnapshots && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Data may be out of date
            </span>
          )}
        </div>
        {canRefresh && creatoriqId && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : !hasSnapshots ? "Fetch first snapshot" : "Refresh now"}
          </button>
        )}
      </div>

      {!hasAnyData && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/50 p-6 text-center">
          <p className="text-sm text-gray-600">No CreatorIQ snapshot or manual audience yet.</p>
          <p className="mt-1 text-xs text-gray-500">
            Click &quot;Fetch first snapshot&quot; to load from CreatorIQ, or use Admin → Manual Audience to enter metrics.
          </p>
        </div>
      )}

      {hasAnyData && (
        <div className="space-y-6">
          {/* 1) Top summary (only when we have CIQ accounts) */}
          {hasSnapshots && <OverviewSummaryCard totals={totals} />}

          {/* 2) Per-account cards */}
          {hasSnapshots && accounts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-3">
                Accounts
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((acc, i) => (
                  <AccountCard
                    key={`${acc.network}-${acc.socialNetworkId}-${i}`}
                    account={acc}
                    isPrimary={primary !== null && acc.network === primary.network && acc.socialNetworkId === primary.socialNetworkId}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 3) Audience per account (only from CIQ) */}
          {hasSnapshots && accounts.length > 0 && (() => {
            const hasAnyAudience = audienceByAccount.some(Boolean);
            return (
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-3">
                  Audience (per account)
                </h3>
                {hasAnyAudience ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {accounts.map((acc, i) => (
                      <AudiencePerAccount
                        key={`aud-${acc.network}-${acc.socialNetworkId}-${i}`}
                        network={acc.network}
                        data={audienceByAccount[i] ?? null}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/30 px-4 py-3">
                    <p className="text-sm text-gray-500">Audience data not available for any account in this snapshot.</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* 4) Interests & Brands */}
          <InterestsBrands interests={interests} brands={brands} />

          {/* 5) Locations */}
          <LocationsWidget data={locations} />
        </div>
      )}
    </section>
  );
}
