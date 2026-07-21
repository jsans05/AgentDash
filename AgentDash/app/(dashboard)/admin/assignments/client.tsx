"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AssignmentCard, TeammateAssignments } from "./types";
import { cn } from "@/lib/utils";

type Props = {
  teammates: TeammateAssignments[];
  athletes: { athlete_id: string; name: string }[];
};

export function AssignmentsClient({ teammates, athletes }: Props) {
  const [teammateFilter, setTeammateFilter] = useState<string>("all");
  const [athleteFilter, setAthleteFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return teammates
      .filter((t) => teammateFilter === "all" || t.user_id === teammateFilter)
      .map((t) => ({
        ...t,
        cards:
          athleteFilter === "all"
            ? t.cards
            : t.cards.filter((c) => c.athletes.some((a) => a.athlete_id === athleteFilter)),
      }))
      .filter((t) => t.cards.length > 0 || teammateFilter === t.user_id);
  }, [teammates, teammateFilter, athleteFilter]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[#B9B2A6]">
          Teammate
          <select
            className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
            value={teammateFilter}
            onChange={(e) => setTeammateFilter(e.target.value)}
          >
            <option value="all">All</option>
            {teammates.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.name} ({t.cards.length})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-[#B9B2A6]">
          Athlete
          <select
            className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
            value={athleteFilter}
            onChange={(e) => setAthleteFilter(e.target.value)}
          >
            <option value="all">All</option>
            {athletes.map((a) => (
              <option key={a.athlete_id} value={a.athlete_id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[#B9B2A6]">No pipeline assignments match these filters.</p>
      ) : (
        filtered.map((t) => (
          <TeammateSection key={t.user_id} teammate={t} />
        ))
      )}
    </div>
  );
}

function TeammateSection({ teammate }: { teammate: TeammateAssignments }) {
  const stageSummary = Object.entries(teammate.stage_counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, count]) => `${stage}: ${count}`)
    .join(" · ");

  return (
    <section className="rounded-lg border border-white/10 bg-[#121714] overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 bg-[#151A17] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[#F4F1EB]">{teammate.name}</h2>
          <p className="text-xs text-[#8E877A]">
            <span className="capitalize">{teammate.role}</span>
            {teammate.email ? ` · ${teammate.email}` : ""}
            {" · "}
            {teammate.cards.length} brand{teammate.cards.length === 1 ? "" : "s"}
          </p>
        </div>
        {stageSummary ? (
          <p className="text-[11px] text-[#B9B2A6]">{stageSummary}</p>
        ) : null}
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[#1A211D] text-[11px] uppercase tracking-wide text-[#8E877A]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Company</th>
              <th className="px-3 py-2 text-left font-medium">Stage</th>
              <th className="px-3 py-2 text-left font-medium">Athletes</th>
              <th className="px-3 py-2 text-left font-medium">Assigned by</th>
              <th className="px-3 py-2 text-left font-medium">Assigned at</th>
            </tr>
          </thead>
          <tbody>
            {teammate.cards.map((card) => (
              <AssignmentRow key={card.pipeline_id} card={card} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignmentRow({ card }: { card: AssignmentCard }) {
  return (
    <tr className="border-t border-white/10 hover:bg-white/[0.03]">
      <td className="px-3 py-2">
        <Link
          href={`/crm?pipeline_id=${card.pipeline_id}`}
          className="font-medium text-[#CEE4D4] hover:underline"
        >
          {card.company_name}
        </Link>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-[#D7D0C4]"
          )}
        >
          {card.stage_label}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {card.athletes.length === 0 ? (
            <span className="text-[#8E877A]">—</span>
          ) : (
            card.athletes.map((a) => (
              <Link
                key={a.athlete_id}
                href={`/athlete/${a.athlete_id}?tab=outreach`}
                className="rounded border border-[#2E7040]/40 bg-[#1B2F21] px-1.5 py-0.5 text-[11px] text-[#DBEEE0] hover:bg-[#23452E]"
              >
                {a.name}
              </Link>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-[#D7D0C4]">
        {card.assigned_by_name ?? <span className="text-[#8E877A]">—</span>}
      </td>
      <td className="px-3 py-2 text-[#B9B2A6]">
        {card.assigned_at
          ? new Date(card.assigned_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "—"}
      </td>
    </tr>
  );
}
