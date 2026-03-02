"use client";

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
import type { AudienceData } from "@/lib/ciq/overview";
import { LocationsWidget } from "./LocationsWidget";

const PIE_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))"];
const BAR_FILL = "hsl(var(--chart-1))";

export function AudiencePerAccount({
  network,
  data,
}: {
  network: string;
  data: AudienceData | null;
}) {
  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
        <p className="text-sm font-medium text-gray-700">{network}</p>
        <p className="mt-2 text-sm text-gray-500">Audience data not available</p>
      </div>
    );
  }

  const hasGender = data.gender.length > 0;
  const hasAge = data.age.length > 0;
  const hasLocations =
    data.locations &&
    (data.locations.countries.length > 0 || data.locations.states.length > 0 || data.locations.cities.length > 0);
  if (!hasGender && !hasAge && !hasLocations) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
        <p className="text-sm font-medium text-gray-700">{network}</p>
        <p className="mt-2 text-sm text-gray-500">Audience data not available</p>
      </div>
    );
  }

  const genderTotal = data.gender.reduce((s, d) => s + d.value, 0);
  const genderNormalized =
    genderTotal > 0 ? data.gender.map((d) => ({ ...d, value: (d.value / genderTotal) * 100 })) : data.gender;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium text-gray-700">{network}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {hasGender && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Gender</p>
            <div className="flex items-center gap-3">
              <div className="h-24 w-24 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={genderNormalized}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius="40%"
                      outerRadius="100%"
                      paddingAngle={1}
                    >
                      {genderNormalized.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="text-sm text-gray-700">
                {data.gender.map((d) => (
                  <li key={d.label}>
                    {d.label}: {d.value.toFixed(1)}%
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {hasAge && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Age</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={data.age}
                  margin={{ top: 0, right: 24, left: 40, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
                  <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" width={36} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="value" name="%" fill={BAR_FILL} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
      {hasLocations && data.locations && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Locations</p>
          <LocationsWidget data={data.locations} />
        </div>
      )}
    </div>
  );
}
