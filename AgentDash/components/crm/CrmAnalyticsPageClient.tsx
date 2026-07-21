"use client";

import { useState } from "react";
import { PipelineAnalyticsDashboard } from "@/components/crm/PipelineAnalyticsDashboard";
import { OutreachAnalyticsPanel } from "@/components/crm/OutreachAnalyticsPanel";
import { cn } from "@/lib/utils";

export function CrmAnalyticsPageClient() {
  const [tab, setTab] = useState<"outreach" | "pipeline">("outreach");

  return (
    <div className="min-h-0 flex-1 rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="flex gap-2 border-b border-white/10 px-4 pt-4 sm:px-6">
        <button
          type="button"
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
            tab === "outreach"
              ? "border-[#2E7040] text-[#F4F1EB]"
              : "border-transparent text-[#8E877A] hover:text-[#D7D0C4]"
          )}
          onClick={() => setTab("outreach")}
        >
          Outreach
        </button>
        <button
          type="button"
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
            tab === "pipeline"
              ? "border-[#2E7040] text-[#F4F1EB]"
              : "border-transparent text-[#8E877A] hover:text-[#D7D0C4]"
          )}
          onClick={() => setTab("pipeline")}
        >
          Pipeline health
        </button>
      </div>
      {tab === "outreach" ? (
        <div className="p-4 sm:p-6">
          <OutreachAnalyticsPanel />
        </div>
      ) : (
        <PipelineAnalyticsDashboard />
      )}
    </div>
  );
}
