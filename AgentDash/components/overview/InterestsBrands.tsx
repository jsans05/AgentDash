"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { InterestItem } from "@/lib/ciq/overview";

const BAR_FILL = "hsl(var(--chart-1))";

function BarChartSection({ title, data }: { title: string; data: InterestItem[] }) {
  if (!data.length) return null;
  const display = data.slice(0, 10);

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={display}
            margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
            <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
            <Bar dataKey="value" name="%" fill={BAR_FILL} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function InterestsBrands({
  interests,
  brands,
}: {
  interests: InterestItem[];
  brands: InterestItem[];
}) {
  const hasInterests = interests.length > 0;
  const hasBrands = brands.length > 0;

  if (!hasInterests && !hasBrands) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-4">
        <p className="text-sm font-medium text-gray-700">Interests &amp; Brands</p>
        <p className="mt-2 text-sm text-gray-500">Data not available in this snapshot</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium text-gray-700">Interests &amp; Brands</p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BarChartSection title="Interests" data={interests} />
        <BarChartSection title="Brands" data={brands} />
      </div>
    </div>
  );
}
