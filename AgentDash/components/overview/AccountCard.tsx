"use client";

import type { OverviewAccount } from "@/lib/ciq/overview";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  twitter: "X",
  x: "X",
};

export function AccountCard({
  account,
  isPrimary,
}: {
  account: OverviewAccount;
  isPrimary: boolean;
}) {
  const platformLabel = PLATFORM_LABELS[account.network.toLowerCase()] ?? account.network;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          {account.logoURL ? (
            <img
              src={account.logoURL}
              alt=""
              className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
              {platformLabel.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-gray-900">
              {account.fullName || platformLabel}
            </p>
            <p className="text-sm text-gray-500">
              {platformLabel}
              {account.networkUser ? ` · ${account.networkUser}` : ""}
            </p>
            {isPrimary && (
              <span className="mt-1 inline-block rounded bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                Primary account
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-semibold text-gray-900">
            {account.followersCount.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">Followers</p>
          {account.viewsCount > 0 && (
            <>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {account.viewsCount.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">Views</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
