"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import type { OutreachAnalyticsSnapshot } from "@/lib/crm/outreach-analytics";

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#151A17] p-4">
      <p className="text-xs font-medium text-[#B9B2A6]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#F4F1EB]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#8E877A]">{hint}</p>}
    </div>
  );
}

export function OutreachAnalyticsPanel() {
  const [data, setData] = useState<OutreachAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/outreach-analytics", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setData(json.analytics as OutreachAnalyticsSnapshot);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="p-4 text-sm text-[#B9B2A6]">Loading outreach analytics…</p>;
  }
  if (error || !data) {
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm text-[#F1A2A2]">{error ?? "No data"}</p>
        <Button size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const variants = categoryFilter
    ? data.variantComparison // category filter is passive — events already snapshot category; for now show all
    : data.variantComparison;

  const hourChart = data.bestHours.filter((h) => h.touches > 0);
  const dowChart = data.bestDow.filter((d) => d.touches > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#F4F1EB]">Outreach performance</h2>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {data.scope === "team" ? "Team-wide" : "Your"} channel, sequence, variant, and timing
            stats — {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
          <Link
            href="/crm/sequence"
            className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-sm text-[#D7D0C4] hover:bg-white/5"
          >
            Sequence board
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Touches" value={String(data.kpis.totalTouches)} />
        <KpiCard label="Replies" value={String(data.kpis.totalReplies)} />
        <KpiCard
          label="Reply rate"
          value={data.kpis.replyRatePct != null ? `${data.kpis.replyRatePct}%` : "—"}
        />
        <KpiCard
          label="Timezone missing"
          value={String(data.kpis.timezoneMissing)}
          hint="Set TZ on cards for best-time analysis"
        />
        <KpiCard label="Variants used" value={String(data.kpis.activeVariants)} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h3 className="text-sm font-semibold text-[#F4F1EB]">Channel performance</h3>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#8E877A]">
                  <th className="py-1 pr-3">Channel</th>
                  <th className="py-1 pr-3">Touches</th>
                  <th className="py-1 pr-3">Replies</th>
                  <th className="py-1 pr-3">Reply %</th>
                  <th className="py-1">Positive %</th>
                </tr>
              </thead>
              <tbody>
                {data.channelPerformance.map((row) => (
                  <tr key={row.channel} className="border-t border-white/5 text-[#ECE7DF]">
                    <td className="py-1.5 pr-3">{row.label}</td>
                    <td className="py-1.5 pr-3">{row.touches}</td>
                    <td className="py-1.5 pr-3">{row.replies}</td>
                    <td className="py-1.5 pr-3">
                      {row.replyRatePct != null ? `${row.replyRatePct}%` : "—"}
                    </td>
                    <td className="py-1.5">
                      {row.positiveRatePct != null ? `${row.positiveRatePct}%` : "—"}
                    </td>
                  </tr>
                ))}
                {data.channelPerformance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-[#8E877A]">
                      No outreach events yet — start logging on the sequence board.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h3 className="text-sm font-semibold text-[#F4F1EB]">Sequence step drop-off</h3>
          <p className="text-xs text-[#8E877A]">Done vs skipped vs responses per step</p>
          <div className="mt-3 overflow-auto max-h-80">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[#8E877A]">
                  <th className="py-1 pr-2">Step</th>
                  <th className="py-1 pr-2">Done</th>
                  <th className="py-1 pr-2">Skip</th>
                  <th className="py-1">Replies</th>
                </tr>
              </thead>
              <tbody>
                {data.stepDropoff.map((row) => (
                  <tr key={row.step_id} className="border-t border-white/5 text-[#ECE7DF]">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium text-[#CEE4D4]">{row.short_code}</span>
                      <span className="ml-2 text-xs text-[#8E877A]">{row.action_label}</span>
                    </td>
                    <td className="py-1.5 pr-2">{row.done}</td>
                    <td className="py-1.5 pr-2">{row.skipped}</td>
                    <td className="py-1.5">{row.responses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#F4F1EB]">A/B/C variant comparison</h3>
            <p className="text-xs text-[#8E877A]">
              Low-sample badge under 50 sends — don&apos;t declare winners early
            </p>
          </div>
          <input
            className="rounded border border-white/15 bg-[#0F1311] px-2 py-1 text-xs text-[#F4F1EB]"
            placeholder="Filter label…"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
        </div>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#8E877A]">
                <th className="py-1 pr-3">Variant</th>
                <th className="py-1 pr-3">Channel</th>
                <th className="py-1 pr-3">Sends</th>
                <th className="py-1 pr-3">Replies</th>
                <th className="py-1 pr-3">Reply %</th>
                <th className="py-1">Positive %</th>
              </tr>
            </thead>
            <tbody>
              {variants
                .filter(
                  (v) =>
                    !categoryFilter ||
                    v.label.toLowerCase().includes(categoryFilter.toLowerCase()) ||
                    v.channel.toLowerCase().includes(categoryFilter.toLowerCase())
                )
                .map((row) => (
                  <tr
                    key={`${row.variant_id ?? "ai"}-${row.channel}-${row.label}`}
                    className="border-t border-white/5 text-[#ECE7DF]"
                  >
                    <td className="py-1.5 pr-3">
                      {row.label}
                      {row.lowSample && (
                        <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">
                          low sample
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{row.channel}</td>
                    <td className="py-1.5 pr-3">{row.sends}</td>
                    <td className="py-1.5 pr-3">{row.replies}</td>
                    <td className="py-1.5 pr-3">
                      {row.replyRatePct != null ? `${row.replyRatePct}%` : "—"}
                    </td>
                    <td className="py-1.5">
                      {row.positiveRatePct != null ? `${row.positiveRatePct}%` : "—"}
                    </td>
                  </tr>
                ))}
              {variants.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-[#8E877A]">
                    No variant sends yet — add copy in My Variants and log sequence touches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h3 className="text-sm font-semibold text-[#F4F1EB]">Best time to send (recipient-local hour)</h3>
          <div className="mt-4 h-56">
            {hourChart.length === 0 ? (
              <p className="text-sm text-[#8E877A]">Set timezones on cards to populate this chart.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                  <XAxis dataKey="hour" tick={{ fill: "#8E877A", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8E877A", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#151A17", border: "1px solid #ffffff20", borderRadius: 8 }}
                  />
                  <Bar dataKey="touches" fill="#2E7040" name="Touches" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="replies" fill="#6E4DC6" name="Replies" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h3 className="text-sm font-semibold text-[#F4F1EB]">Best day (recipient-local)</h3>
          <div className="mt-4 h-56">
            {dowChart.length === 0 ? (
              <p className="text-sm text-[#8E877A]">Set timezones on cards to populate this chart.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dowChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                  <XAxis dataKey="label" tick={{ fill: "#8E877A", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8E877A", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#151A17", border: "1px solid #ffffff20", borderRadius: 8 }}
                  />
                  <Bar dataKey="touches" fill="#2E7040" name="Touches" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="replies" fill="#6E4DC6" name="Replies" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
        <h3 className="text-sm font-semibold text-[#F4F1EB]">Weekly trends</h3>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.weeklyTouches}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
              <XAxis
                dataKey="week"
                tick={{ fill: "#8E877A", fontSize: 10 }}
                tickFormatter={(v) => String(v).slice(5)}
              />
              <YAxis tick={{ fill: "#8E877A", fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#151A17", border: "1px solid #ffffff20", borderRadius: 8 }}
              />
              <Bar dataKey="count" fill="#2E7040" name="Touches" radius={[4, 4, 0, 0]} />
              <Bar dataKey="replies" fill="#6E4DC6" name="Replies" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
