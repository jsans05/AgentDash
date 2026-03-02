"use client";

import type { OverviewTotals } from "@/lib/ciq/overview";

export function OverviewSummaryCard({ totals }: { totals: OverviewTotals }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Followers</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">
          {totals.totalFollowers.toLocaleString()}
        </p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total Views</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">
          {totals.totalViews.toLocaleString()}
        </p>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Accounts</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{totals.accountCount}</p>
      </div>
    </div>
  );
}
