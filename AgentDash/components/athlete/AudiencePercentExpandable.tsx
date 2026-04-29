"use client";

import { useState } from "react";
import {
  AudiencePercentList,
  type AudiencePercentListRow,
} from "@/components/athlete/AudiencePercentList";

type Props = {
  rows: AudiencePercentListRow[];
  previewLimit?: number;
  showCount?: boolean;
  countInLabel?: boolean;
  emptyText?: string;
};

export function AudiencePercentExpandable({
  rows,
  previewLimit = 5,
  showCount,
  countInLabel,
  emptyText,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const safe = Array.isArray(rows) ? rows : [];
  const hasMore = safe.length > previewLimit;
  const limit = expanded ? safe.length : previewLimit;

  return (
    <div>
      <AudiencePercentList
        rows={safe}
        limit={limit}
        showCount={showCount}
        countInLabel={countInLabel}
        emptyText={emptyText}
      />
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-[#CEE4D4] hover:text-[#E8F6ED]"
        >
          {expanded ? "Show less" : `View all (${safe.length})`}
        </button>
      )}
    </div>
  );
}
