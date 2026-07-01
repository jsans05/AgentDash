"use client";

import { useState } from "react";
import type { CompanyAgencyActivity } from "@/lib/crm/company-agency-activity";
import { isEmptyAgencyActivity } from "@/lib/crm/company-agency-activity";

function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function buildSummary(activity: CompanyAgencyActivity): string {
  const agentIds = new Set<string>();
  for (const entry of activity.on_other_target_lists) agentIds.add(entry.agent_user_id);
  for (const entry of activity.contacted_by_others) agentIds.add(entry.agent_user_id);

  const parts: string[] = [];
  if (agentIds.size > 0) {
    parts.push(`${agentIds.size} agent${agentIds.size === 1 ? "" : "s"}`);
  }
  const latestOutreach = activity.contacted_by_others
    .map((e) => e.last_outreach_at)
    .filter(Boolean)
    .sort()
    .pop();
  const dateLabel = formatShortDate(latestOutreach ?? null);
  if (dateLabel) parts.push(`last outreach ${dateLabel}`);
  return parts.join(" · ");
}

export function AgencyActivityCell({
  activity,
}: {
  activity: CompanyAgencyActivity | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  if (isEmptyAgencyActivity(activity)) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }

  const summary = buildSummary(activity!);

  return (
    <div className="relative min-w-[10rem] text-xs text-[#ECE7DF]">
      <button
        type="button"
        className="text-left text-[#CEE4D4] hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {summary || "View activity"}
      </button>
      {open ? (
        <div
          className="absolute left-0 top-full z-20 mt-1 max-w-xs rounded-md border border-white/15 bg-[#141A17] p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {activity!.on_other_target_lists.length > 0 ? (
            <div className="mb-2 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">
                On other target lists
              </p>
              {activity!.on_other_target_lists.map((entry) => (
                <p key={`tl-${entry.agent_user_id}`}>
                  <span className="font-medium">{entry.agent_name}</span>
                  {entry.athlete_names.length > 0 ? (
                    <span className="text-[#B9B2A6]"> · {entry.athlete_names.join(", ")}</span>
                  ) : null}
                  {entry.pipeline_stage ? (
                    <span className="text-[#8E877A]"> ({entry.pipeline_stage})</span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
          {activity!.contacted_by_others.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">
                Contacted by other agents
              </p>
              {activity!.contacted_by_others.map((entry) => (
                <p key={`out-${entry.agent_user_id}-${entry.last_outreach_at ?? ""}`}>
                  <span className="font-medium">{entry.agent_name}</span>
                  {entry.last_outreach_at ? (
                    <span className="text-[#B9B2A6]">
                      {" "}
                      · {formatShortDate(entry.last_outreach_at) ?? entry.last_outreach_at.slice(0, 10)}
                    </span>
                  ) : null}
                  {entry.outreach_channel ? (
                    <span className="text-[#8E877A]"> ({entry.outreach_channel})</span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
