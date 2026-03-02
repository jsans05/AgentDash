"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CreatorIQSnapshot,
  CiqEngagementRateSnapshot,
  CiqAccountInfoSnapshot,
} from "@/lib/supabase/types";
import {
  getAudienceSummary,
  parseEngagementFromAccounts,
  parseTopPosts,
} from "@/lib/creatoriq-summary";
import {
  GenderSection,
  AgeSection,
  LocationSection,
  InterestsSection,
  EngagementSection,
  TopPostsSection,
} from "./creatoriq-summary-sections";

type Props = {
  athleteId: string;
  creatoriqId: string | null;
  snapshots: CreatorIQSnapshot[];
};

/** Find accounts array from various API response shapes (including { "1867893": [...] }) */
function getAccountsList(raw: Record<string, unknown>): unknown[] {
  const r = raw as Record<string, unknown>;
  for (const key of ["accounts", "social_accounts", "data"]) {
    const v = r[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).accounts))
      return (v as Record<string, unknown>).accounts as unknown[];
    if (v && typeof v === "object" && Array.isArray((v as Record<string, unknown>).social_accounts))
      return (v as Record<string, unknown>).social_accounts as unknown[];
  }
  const embedded = r._embedded as Record<string, unknown> | undefined;
  if (embedded && Array.isArray(embedded.accounts)) return embedded.accounts;
  if (embedded && Array.isArray(embedded.social_accounts)) return embedded.social_accounts;
  // CreatorIQ shape: root is { "publisherId": [ account, ... ] }
  for (const key of Object.keys(r)) {
    const v = r[key];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      const first = v[0] as Record<string, unknown>;
      if (first.Network != null || first.network != null || first.platform != null || first.FollowersCount != null || first.followers != null)
        return v;
    }
  }
  return [];
}

/** Extract displayable summary from CreatorIQ raw_json (structure varies by API) */
function snapshotSummary(type: string, raw: Record<string, unknown>): { label: string; value: string }[] {
  const items: { label: string; value: string }[] = [];
  const r = raw as Record<string, unknown>;
  if (type === "audience") {
    const total = r.total ?? r.total_followers ?? r.followers ?? r.reach;
    if (total != null) items.push({ label: "Total reach / followers", value: String(total) });
    const demographics = (r.demographics ?? r.audience_demographics) as Record<string, unknown> | undefined;
    if (demographics && typeof demographics === "object") {
      const keys = Object.keys(demographics).slice(0, 5);
      keys.forEach((k) => {
        const v = demographics[k];
        if (v != null && typeof v !== "object") items.push({ label: k.replace(/_/g, " "), value: String(v) });
      });
    }
    if (items.length === 0 && (r.href != null || r.type != null)) {
      if (r.type != null) items.push({ label: "Type", value: String(r.type) });
      if (typeof r.href === "string") items.push({ label: "Endpoint", value: r.href });
    }
  }
  if (type === "accounts" || type === "social") {
    const accounts = getAccountsList(raw);
    if (accounts.length > 0) {
      accounts.slice(0, 8).forEach((acc: unknown) => {
        const a = acc as Record<string, unknown>;
        const platform = (a.Network ?? a.platform ?? a.network ?? a.type ?? "Account") as string;
        const followers = a.FollowersCount ?? a.followers ?? a.follower_count ?? a.total_followers;
        const username = a.NetworkUser ?? a.username ?? a.handle;
        const name = a.FullName ?? a.full_name;
        const label = name ? `${String(platform)} · ${String(name)}` : `${platform}${username ? ` @${String(username)}` : ""}`;
        items.push({
          label,
          value: typeof followers === "number" ? followers.toLocaleString() : followers != null ? String(followers) : "—",
        });
      });
    } else {
      const followers = r.total_followers ?? r.followers;
      if (followers != null) items.push({ label: "Followers", value: String(followers) });
    }
  }
  if (type === "publisher") {
    const name = r.name ?? r.display_name ?? r.publisher_name;
    if (name) items.push({ label: "Name", value: String(name) });
    const id = r.id ?? r.publisher_id;
    if (id) items.push({ label: "Publisher ID", value: String(id) });
  }
  if (items.length === 0 && typeof raw === "object") {
    const keys = Object.keys(raw).filter((k) => !k.startsWith("_")).slice(0, 6);
    keys.forEach((k) => {
      const v = (raw as Record<string, unknown>)[k];
      if (v != null && typeof v !== "object") items.push({ label: k.replace(/_/g, " "), value: String(v) });
    });
  }
  return items;
}

function SnapshotCard({ snapshot, defaultOpen = false }: { snapshot: CreatorIQSnapshot; defaultOpen?: boolean }) {
  const [showRaw, setShowRaw] = useState(defaultOpen);
  const summary = snapshotSummary(snapshot.snapshot_type, snapshot.raw_json || {});
  const typeLabel = snapshot.snapshot_type.charAt(0).toUpperCase() + snapshot.snapshot_type.slice(1);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
        <span className="font-medium text-gray-900">{typeLabel}</span>
        <span className="text-xs text-gray-500">
          {new Date(snapshot.fetched_at).toLocaleString()}
        </span>
      </div>
      <div className="p-4">
        {summary.length > 0 ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {summary.map((s, i) => (
              <div key={i}>
                <dt className="text-gray-500">{s.label}</dt>
                <dd className="font-medium text-gray-900">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-gray-500">No summary extracted. View raw data below.</p>
        )}
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          {showRaw ? "Hide" : "View"} raw data
        </button>
        {showRaw && (
          <pre className="mt-2 text-xs overflow-auto max-h-48 bg-gray-50 p-3 rounded border border-gray-100">
            {JSON.stringify(snapshot.raw_json, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function CreatorIQInsights({ athleteId, creatoriqId, snapshots }: Props) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [engagementSnapshot, setEngagementSnapshot] = useState<CiqEngagementRateSnapshot | null>(null);
  const [loadingEngagement, setLoadingEngagement] = useState(false);
  const [accountInfoSnapshots, setAccountInfoSnapshots] = useState<CiqAccountInfoSnapshot[]>([]);
  const [loadingAccountInfo, setLoadingAccountInfo] = useState(false);

  async function loadLatestEngagement() {
    if (!creatoriqId) return;
    try {
      setLoadingEngagement(true);
      const res = await fetch(`/api/ciq/engagement-rate/latest?athleteId=${encodeURIComponent(athleteId)}`, {
        method: "GET",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to load engagement snapshot", data.error);
        setEngagementSnapshot(null);
        return;
      }
      setEngagementSnapshot(data.snapshot ?? null);
    } finally {
      setLoadingEngagement(false);
    }
  }

  async function refreshCIQ() {
    if (!creatoriqId) return;
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
        // Also refresh engagement rate snapshot in parallel
        await fetch("/api/ciq/engagement-rate/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athlete_id: athleteId }),
          credentials: "include",
        }).catch(() => {});
        await loadLatestEngagement();
        // Refresh accountInfo snapshots as well
        await fetch("/api/ciq/account-info/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athlete_id: athleteId }),
          credentials: "include",
        }).catch(() => {});
        await loadLatestAccountInfo();
        router.refresh();
      } else {
        alert(data.error || "Failed to refresh CreatorIQ data");
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function loadLatestAccountInfo() {
    if (!creatoriqId) return;
    try {
      setLoadingAccountInfo(true);
      const res = await fetch(
        `/api/ciq/account-info/latest?athleteId=${encodeURIComponent(athleteId)}`,
        {
          method: "GET",
          credentials: "include",
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Failed to load accountInfo snapshots", data.error);
        setAccountInfoSnapshots([]);
        return;
      }
      setAccountInfoSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
    } finally {
      setLoadingAccountInfo(false);
    }
  }

  // No Creator ID set
  if (!creatoriqId) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-900 mb-3">CreatorIQ Insights</h2>
        <p className="text-sm text-gray-500">
          Set the CreatorIQ Creator ID in Basic Information above (from app.creatoriq.com/#creator/...), then fetch data here.
        </p>
      </section>
    );
  }

  // ID set but no data yet
  if (snapshots.length === 0) {
    return (
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-medium text-gray-900">CreatorIQ Insights</h2>
          <button
            onClick={refreshCIQ}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshing ? "Fetching…" : "Fetch CreatorIQ data"}
          </button>
        </div>
        <div className="border border-dashed border-gray-300 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-600 mb-1">Creator ID is set. Click &quot;Fetch CreatorIQ data&quot; to load audience, social accounts, and creator info.</p>
          <p className="text-xs text-gray-500">Data is pulled from CreatorIQ and stored for this athlete.</p>
        </div>
      </section>
    );
  }

  // Latest snapshot per type (first = most recent for that type)
  const byType = new Map<string, CreatorIQSnapshot>();
  for (const s of snapshots) {
    if (!byType.has(s.snapshot_type)) byType.set(s.snapshot_type, s);
  }
  const latestAudience = byType.get("audience");
  const latestAccounts = byType.get("accounts") ?? byType.get("social");
  const audienceSummary = latestAudience
    ? getAudienceSummary((latestAudience.raw_json || {}) as Record<string, unknown>)
    : null;
  const engagementList = latestAccounts
    ? parseEngagementFromAccounts((latestAccounts.raw_json || {}) as Record<string, unknown>)
    : [];
  const topPostsFromAudience = latestAudience
    ? parseTopPosts((latestAudience.raw_json || {}) as Record<string, unknown>)
    : [];
  const topPostsFromAccounts = latestAccounts
    ? parseTopPosts((latestAccounts.raw_json || {}) as Record<string, unknown>)
    : [];
  const topPosts = topPostsFromAudience.length ? topPostsFromAudience : topPostsFromAccounts;

  const hasParsedSummary =
    audienceSummary &&
    (audienceSummary.gender.length > 0 ||
      audienceSummary.age.length > 0 ||
      audienceSummary.countries.length > 0 ||
      audienceSummary.states.length > 0 ||
      audienceSummary.cities.length > 0 ||
      audienceSummary.interests.length > 0);
  const showSummaryCard =
    hasParsedSummary || engagementList.length > 0 || topPosts.length > 0;
  const order = ["accounts", "audience", "publisher", "social"];
  const latest = order.map((t) => byType.get(t)).filter(Boolean) as CreatorIQSnapshot[];

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-medium text-gray-900">CreatorIQ Insights</h2>
        <button
          onClick={refreshCIQ}
          disabled={refreshing}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh CIQ"}
        </button>
      </div>

      {/* AccountInfo (latest per account) */}
      <div className="mb-4">
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <span className="font-medium text-gray-900">AccountInfo (latest)</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  setLoadingAccountInfo(true);
                  try {
                    const res = await fetch("/api/ciq/account-info/refresh", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ athlete_id: athleteId }),
                      credentials: "include",
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      alert(data.error || "Failed to fetch accountInfo");
                    } else {
                      await loadLatestAccountInfo();
                    }
                  } finally {
                    setLoadingAccountInfo(false);
                  }
                }}
                disabled={loadingAccountInfo}
                className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50"
              >
                {loadingAccountInfo
                  ? "Fetching…"
                  : accountInfoSnapshots.length
                  ? "Refresh accountInfo"
                  : "Fetch accountInfo now"}
              </button>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {accountInfoSnapshots.length ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Network
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Handle
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Followers
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Posts
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Avg Likes (10)
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Avg Comments (10)
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Verified
                        </th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {accountInfoSnapshots.map((s) => {
                        const m = s.metrics || {};
                        return (
                          <tr key={s.id}>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {s.network ?? m.type ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {s.account_handle ?? m.name ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {typeof m.followers === "number"
                                ? m.followers.toLocaleString()
                                : m.followers ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {typeof m.posts === "number" ? m.posts.toLocaleString() : m.posts ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {typeof m.avgLikes10 === "number"
                                ? m.avgLikes10.toLocaleString(undefined, { maximumFractionDigits: 1 })
                                : m.avgLikes10 ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {typeof m.avgComments10 === "number"
                                ? m.avgComments10.toLocaleString(undefined, { maximumFractionDigits: 1 })
                                : m.avgComments10 ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                              {typeof m.verified === "boolean" ? (m.verified ? "Yes" : "No") : "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-right text-sm">
                              <details>
                                <summary className="text-blue-600 hover:text-blue-800 cursor-pointer">
                                  Raw JSON
                                </summary>
                                <pre className="mt-2 text-xs overflow-auto max-h-64 bg-gray-50 p-3 rounded border border-gray-100">
                                  {JSON.stringify(s.raw ?? {}, null, 2)}
                                </pre>
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No accountInfo snapshots yet for this athlete. Click &quot;Fetch accountInfo now&quot; to
                create them based on the latest accounts snapshot.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Engagement rate (latest snapshot) */}
      <div className="mb-4">
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <span className="font-medium text-gray-900">Engagement rate (latest snapshot)</span>
            <div className="flex items-center gap-3">
              {engagementSnapshot?.created_at && (
                <span className="text-xs text-gray-500">
                  {new Date(engagementSnapshot.created_at).toLocaleString()}
                </span>
              )}
              <button
                type="button"
                onClick={async () => {
                  setLoadingEngagement(true);
                  try {
                    const res = await fetch("/api/ciq/engagement-rate/refresh", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ athlete_id: athleteId }),
                      credentials: "include",
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      alert(data.error || "Failed to fetch engagement rate");
                    } else {
                      await loadLatestEngagement();
                    }
                  } finally {
                    setLoadingEngagement(false);
                  }
                }}
                disabled={loadingEngagement}
                className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-700 disabled:opacity-50"
              >
                {loadingEngagement ? "Fetching…" : engagementSnapshot ? "Refresh engagement" : "Fetch engagement rate now"}
              </button>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {engagementSnapshot ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
                  {Object.entries(engagementSnapshot.metrics || {}).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-gray-500">{k.replace(/_/g, " ")}</div>
                      <div className="font-medium text-gray-900">
                        {typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
                <details className="mt-2">
                  <summary className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer">
                    Raw JSON
                  </summary>
                  <pre className="mt-2 text-xs overflow-auto max-h-64 bg-gray-50 p-3 rounded border border-gray-100">
                    {JSON.stringify(engagementSnapshot.raw ?? {}, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p className="text-sm text-gray-500">
                No engagement rate snapshot yet for this athlete. Click &quot;Fetch engagement rate now&quot; to create one.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Summary card: show whenever we have snapshots; if nothing parsed, show fallback message */}
      {(latestAudience ?? latestAccounts) && (
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
            <span className="font-medium text-gray-900">Audience &amp; engagement</span>
            {(latestAudience ?? latestAccounts)?.fetched_at && (
              <span className="text-xs text-gray-500">
                {new Date((latestAudience ?? latestAccounts)!.fetched_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {showSummaryCard ? (
              <>
                <div className="space-y-6">
                  {audienceSummary?.gender.length ? <GenderSection data={audienceSummary.gender} /> : null}
                  {audienceSummary?.age.length ? <AgeSection data={audienceSummary.age} /> : null}
                  {(audienceSummary?.countries.length ?? 0) + (audienceSummary?.states.length ?? 0) + (audienceSummary?.cities.length ?? 0) > 0 && audienceSummary ? (
                    <LocationSection
                      countries={audienceSummary.countries}
                      states={audienceSummary.states}
                      cities={audienceSummary.cities}
                    />
                  ) : null}
                  {audienceSummary?.interests.length ? <InterestsSection data={audienceSummary.interests} /> : null}
                </div>
                <div className="space-y-6">
                  <EngagementSection data={engagementList} />
                  <TopPostsSection data={topPosts} />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500 col-span-full">
                No demographics or engagement could be parsed from this response. The API may use a different structure—expand the raw data in the cards below to inspect it.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Raw snapshot cards with "View raw data" */}
      <div className="space-y-4">
        {latest.map((snapshot) => (
          <SnapshotCard key={snapshot.snapshot_id} snapshot={snapshot} />
        ))}
      </div>
    </section>
  );
}
