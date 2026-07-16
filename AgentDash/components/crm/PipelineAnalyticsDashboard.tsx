"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { PipelineAnalyticsSnapshot } from "@/lib/crm/pipeline-analytics";

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#151A17] p-4">
      <p className="text-xs font-medium text-[#B9B2A6]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#F4F1EB]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#8E877A]">{hint}</p>}
    </div>
  );
}

export function PipelineAnalyticsDashboard() {
  const [data, setData] = useState<PipelineAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/pipeline/analytics", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load analytics");
      setData(json.analytics as PipelineAnalyticsSnapshot);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="p-8 text-sm text-[#B9B2A6]">Loading pipeline analytics…</p>;
  }

  if (error || !data) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-[#F1A2A2]">{error ?? "No data"}</p>
        <Button size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const funnelData = data.stageCounts.map((s) => ({ name: s.label, count: s.count }));
  const maxCategory = Math.max(1, ...data.categoryMix.map((c) => c.count));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#F4F1EB]">Pipeline analytics</h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {data.scope === "team" ? "Team-wide" : "Your"} pipeline health — updated{" "}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <Link
            href="/crm"
            className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-sm text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
          >
            Open pipeline
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Active cards" value={String(data.kpis.totalActive)} />
        <KpiCard label="In outreach" value={String(data.kpis.inOutreachFlow)} hint="Send + Follow-up + Bounced" />
        <KpiCard label="Due now" value={String(data.kpis.dueNow)} hint="Actionable this week" />
        <KpiCard label="Cooling" value={String(data.kpis.cooling)} hint="Before ghost" />
        <KpiCard
          label="Reply rate"
          value={data.kpis.responseRatePct != null ? `${data.kpis.responseRatePct}%` : "—"}
          hint="Of contacted brands"
        />
        <KpiCard
          label="Avg days to reply"
          value={data.kpis.avgDaysToResponse != null ? String(data.kpis.avgDaysToResponse) : "—"}
        />
        <KpiCard label="Closed deals" value={String(data.kpis.closedDeals)} />
        <KpiCard label="Closed value" value={fmtMoney(data.kpis.closedValue)} />
      </div>

      {data.improvements.length > 0 && (
        <section className="rounded-lg border border-[#2E7040]/30 bg-[#141916] p-4">
          <h2 className="text-sm font-semibold text-[#A7E0B6]">Areas to improve</h2>
          <ul className="mt-3 space-y-2">
            {data.improvements.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  item.severity === "high" && "border-red-400/40 bg-red-950/20",
                  item.severity === "medium" && "border-amber-400/40 bg-amber-950/15",
                  item.severity === "low" && "border-white/10 bg-[#171D1A]"
                )}
              >
                <div className="text-sm font-medium text-[#F4F1EB]">{item.title}</div>
                <div className="text-xs text-[#B9B2A6]">{item.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h2 className="text-sm font-semibold text-[#F4F1EB]">Funnel by stage</h2>
          <p className="text-xs text-[#8E877A]">Where brands sit today</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                <XAxis dataKey="name" tick={{ fill: "#8E877A", fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={60} />
                <YAxis tick={{ fill: "#8E877A", fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#151A17", border: "1px solid #ffffff20", borderRadius: 8 }}
                  labelStyle={{ color: "#F4F1EB" }}
                />
                <Bar dataKey="count" fill="#2E7040" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h2 className="text-sm font-semibold text-[#F4F1EB]">Weekly outreach touches</h2>
          <p className="text-xs text-[#8E877A]">Initial sends + logged follow-ups (8 weeks)</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weeklyTouches} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                <XAxis
                  dataKey="week"
                  tick={{ fill: "#8E877A", fontSize: 10 }}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis tick={{ fill: "#8E877A", fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#151A17", border: "1px solid #ffffff20", borderRadius: 8 }}
                  labelStyle={{ color: "#F4F1EB" }}
                />
                <Bar dataKey="count" fill="#6E4DC6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h2 className="text-sm font-semibold text-[#F4F1EB]">Due breakdown</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between text-[#ECE7DF]">
              <span>Emails due</span>
              <span>{data.dueBuckets.email}</span>
            </li>
            <li className="flex justify-between text-[#ECE7DF]">
              <span>Calls due</span>
              <span>{data.dueBuckets.call}</span>
            </li>
            <li className="flex justify-between text-[#ECE7DF]">
              <span>LinkedIn due</span>
              <span>{data.dueBuckets.linkedin}</span>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#151A17] p-4">
          <h2 className="text-sm font-semibold text-[#F4F1EB]">Category mix</h2>
          <ul className="mt-3 space-y-2">
            {data.categoryMix.length === 0 && (
              <li className="text-sm text-[#8E877A]">No category data yet.</li>
            )}
            {data.categoryMix.map((row) => (
              <li key={row.name}>
                <div className="flex justify-between text-sm text-[#ECE7DF]">
                  <span className="truncate pr-2">{row.name}</span>
                  <span>{row.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-white/10">
                  <div
                    className="h-1.5 rounded bg-[#2E7040]"
                    style={{ width: `${(row.count / maxCategory) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

    </div>
  );
}
