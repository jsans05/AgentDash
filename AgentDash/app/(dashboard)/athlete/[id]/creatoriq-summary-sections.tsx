"use client";

import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type {
  GenderSlice,
  AgeBucket,
  LocationItem,
  InterestItem,
  EngagementPlatform,
  TopPostItem,
} from "@/lib/creatoriq-summary";

const CHART_COLORS = ["#0d9488", "#94a3b8", "#64748b", "#475569"];
const GENDER_COLORS = ["#0d9488", "#94a3b8"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700 mb-3">
      {children}
    </h3>
  );
}

export function GenderSection({ data }: { data: GenderSlice[] }) {
  if (!data.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  const normalized = total > 0 ? data.map((d) => ({ ...d, value: (d.value / total) * 100 })) : data;

  return (
    <div className="space-y-2">
      <SectionTitle>Gender</SectionTitle>
      <div className="flex items-center gap-4">
        <div className="w-32 h-32 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={normalized}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="50%"
                outerRadius="100%"
                paddingAngle={1}
              >
                {normalized.map((_, i) => (
                  <Cell key={i} fill={GENDER_COLORS[i % GENDER_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="text-sm text-gray-700 space-y-1">
          {data.map((d, i) => (
            <li key={d.label}>
              <span className="font-medium">{d.label}:</span> {d.value.toFixed(1)}%
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AgeSection({ data }: { data: AgeBucket[] }) {
  if (!data.length) return null;

  return (
    <div className="space-y-2">
      <SectionTitle>Age</SectionTitle>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 0, right: 24, left: 48, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
            <XAxis type="number" unit="%" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="label" width={44} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
            <Bar dataKey="value" name="Audience %" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type LocationTab = "countries" | "states" | "cities";

export function LocationSection({
  countries,
  states,
  cities,
  initialShow = 5,
}: {
  countries: LocationItem[];
  states: LocationItem[];
  cities: LocationItem[];
  initialShow?: number;
}) {
  const [tab, setTab] = useState<LocationTab>("countries");
  const [showMore, setShowMore] = useState(false);

  const list =
    tab === "countries" ? countries : tab === "states" ? states : cities;
  const hasTabs = [countries.length, states.length, cities.length].filter(Boolean).length > 1;
  const displayList = showMore ? list : list.slice(0, initialShow);
  const hasMore = list.length > initialShow;

  if (!countries.length && !states.length && !cities.length) return null;

  return (
    <div className="space-y-2">
      <SectionTitle>Location</SectionTitle>
      {hasTabs && (
        <div className="flex gap-2 border-b border-gray-200 pb-2">
          {countries.length ? (
            <button
              type="button"
              onClick={() => setTab("countries")}
              className={`px-3 py-1.5 text-sm font-medium rounded ${
                tab === "countries" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Countries
            </button>
          ) : null}
          {states.length ? (
            <button
              type="button"
              onClick={() => setTab("states")}
              className={`px-3 py-1.5 text-sm font-medium rounded ${
                tab === "states" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              U.S. States
            </button>
          ) : null}
          {cities.length ? (
            <button
              type="button"
              onClick={() => setTab("cities")}
              className={`px-3 py-1.5 text-sm font-medium rounded ${
                tab === "cities" ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Cities
            </button>
          ) : null}
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-gray-500">No {tab} data.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {displayList.map((item, i) => (
              <div key={`${tab}-${i}-${item.name}`} className="flex items-center gap-2">
                <div
                  className="h-2 rounded bg-teal-600 flex-shrink-0"
                  style={{ width: `${Math.min(100, item.value * 2)}%`, maxWidth: 120 }}
                />
                <span className="text-sm text-gray-700 flex-shrink-0 w-24">{item.name}</span>
                <span className="text-sm font-medium text-gray-900">{item.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowMore(!showMore)}
              className="text-sm text-teal-600 hover:text-teal-800 mt-1"
            >
              {showMore ? "Show less" : `Show ${list.length - initialShow} more...`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function InterestsSection({ data }: { data: InterestItem[] }) {
  if (!data.length) return null;

  return (
    <div className="space-y-2">
      <SectionTitle>Audience interests</SectionTitle>
      <div className="h-64 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data.slice(0, 12)}
            margin={{ top: 0, right: 48, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
            <XAxis type="number" unit="%" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} labelFormatter={(l) => l} />
            <Bar dataKey="value" name="Audience %" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function EngagementSection({ data }: { data: EngagementPlatform[] }) {
  if (!data.length) return null;

  return (
    <div className="space-y-2">
      <SectionTitle>Engagement</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {data.map((p) => (
          <div
            key={p.platform}
            className="border border-gray-200 rounded-lg p-4 bg-gray-50/50"
          >
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              {p.label}
            </p>
            <p className="text-xl font-semibold text-gray-900">{p.value.toFixed(2)}%</p>
            <p className="text-xs text-gray-500">Engagement rate</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopPostsSection({ data }: { data: TopPostItem[] }) {
  if (!data.length) return null;

  const [index, setIndex] = useState(0);
  const visible = data.slice(index, index + 3);
  const hasPrev = index > 0;
  const hasNext = index + 3 < data.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Top posts</SectionTitle>
        {(hasPrev || hasNext) && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={!hasPrev}
              className="p-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(data.length - 3, i + 1))}
              disabled={!hasNext}
              className="p-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Next"
            >
              ›
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-3 overflow-hidden">
        {visible.map((post, i) => (
          <div
            key={`${post.platform}-${i}`}
            className="flex-shrink-0 w-32 border border-gray-200 rounded-lg overflow-hidden bg-gray-50"
          >
            {post.imageUrl ? (
              <img
                src={post.imageUrl}
                alt={post.label ?? "Post"}
                className="w-full aspect-square object-cover"
              />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center text-gray-400 text-xs">
                No image
              </div>
            )}
            <div className="p-2 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-600 uppercase">{post.platform || "Post"}</p>
              {post.label && (
                <p className="text-xs text-gray-500 truncate" title={post.label}>
                  {post.label}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
