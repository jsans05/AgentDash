"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isStepBlocked,
  isStepDue,
  phaseLabel,
  type CardStepState,
  type SequenceStepDef,
  type TouchStatus,
  type ResponseStatus,
} from "@/lib/crm/outreach-sequence";
import { TimezoneSelect } from "@/components/crm/TimezoneSelect";
import {
  buildFilterOptionsFromCards,
  FILTER_UNCATEGORIZED,
  FILTER_UNASSIGNED_ATHLETE,
} from "@/lib/crm/pipeline-card-filter-sort";
import {
  canonicalizeCompanyCategory,
  isEffectivelyUncategorizedCompanyCategory,
} from "@/lib/crm/company-category";

type PotentialAthlete = {
  athlete_id: string;
  name?: string;
  sport?: string | null;
};

type BoardRow = {
  id: string;
  company_id: string;
  company_name: string;
  product_category: string | null;
  pipeline_stage: string;
  timezone: string | null;
  sequence_id: string | null;
  sequence_started_at: string | null;
  responded_at: string | null;
  website_url?: string | null;
  company_website?: string | null;
  potential_athletes: PotentialAthlete[];
  states: CardStepState[];
};

type BoardPayload = {
  sequence: { id: string; name: string; version: number } | null;
  steps: SequenceStepDef[];
  rows: BoardRow[];
};

const UNCATEGORIZED_LABEL = "Uncategorized";

function categoryKey(category: string | null | undefined): string {
  if (isEffectivelyUncategorizedCompanyCategory(category)) return UNCATEGORIZED_LABEL;
  return canonicalizeCompanyCategory(category) ?? UNCATEGORIZED_LABEL;
}

function parsePotentialAthletes(raw: unknown): PotentialAthlete[] {
  if (!Array.isArray(raw)) return [];
  const out: PotentialAthlete[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    const athlete_id = String(rec.athlete_id ?? "").trim();
    if (!athlete_id) continue;
    out.push({
      athlete_id,
      name: rec.name != null ? String(rec.name) : undefined,
      sport: rec.sport != null ? String(rec.sport) : null,
    });
  }
  return out;
}

function touchClass(status: TouchStatus, due: boolean, blocked: boolean): string {
  if (blocked) return "bg-[#2A2A2A] text-[#6E6E6E]";
  if (status === "done") return "bg-[#2F5D3A] text-[#E8F6ED]";
  if (status === "skipped") return "bg-[#3A3A42] text-[#B9B2A6]";
  if (due) return "bg-[#3A3420] text-[#F4E8C0] ring-2 ring-amber-400/70";
  return "bg-[#1E2420] text-[#8E877A]";
}

function responseClass(status: ResponseStatus): string {
  if (status === "responded") return "bg-[#2F5D3A] text-[#E8F6ED]";
  if (status === "no_response") return "bg-[#6B2E2E] text-[#F1A2A2]";
  return "bg-[#151A17] text-[#5E574C] border border-dashed border-white/10";
}

export function SequenceBoard() {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDue, setFilterDue] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAthleteId, setFilterAthleteId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [seqRes, pipeRes] = await Promise.all([
        fetch("/api/crm/sequence", { credentials: "include" }),
        fetch("/api/crm/pipeline", { credentials: "include" }),
      ]);
      const seqJson = await seqRes.json().catch(() => ({}));
      const pipeJson = await pipeRes.json().catch(() => ({}));
      if (!seqRes.ok) throw new Error(seqJson.error ?? "Failed to load sequence");
      if (!pipeRes.ok) throw new Error(pipeJson.error ?? "Failed to load pipeline");

      const steps = (seqJson.steps ?? []) as SequenceStepDef[];
      const cards = (pipeJson.cards ?? pipeJson.pipeline ?? []) as Array<Record<string, unknown>>;

      const activeCards = cards.filter((c) => {
        const stage = String(c.pipeline_stage ?? "");
        return (
          !c.archived &&
          ["outreach", "follow_up", "bounced", "drafting", "target", "in_progress"].includes(stage)
        );
      });

      const rows: BoardRow[] = [];
      const chunk = activeCards.slice(0, 80);
      await Promise.all(
        chunk.map(async (c) => {
          const id = String(c.id);
          let states: CardStepState[] = [];
          let sequence_started_at =
            c.sequence_started_at != null ? String(c.sequence_started_at) : null;
          let sequence_id = c.sequence_id != null ? String(c.sequence_id) : null;
          let timezone = c.timezone != null ? String(c.timezone) : null;
          let responded_at = c.responded_at != null ? String(c.responded_at) : null;

          if (sequence_started_at || ["outreach", "follow_up"].includes(String(c.pipeline_stage))) {
            const r = await fetch(`/api/crm/sequence?card_id=${encodeURIComponent(id)}`, {
              credentials: "include",
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok) {
              states = (j.states ?? []) as CardStepState[];
              if (j.card) {
                sequence_started_at = j.card.sequence_started_at ?? sequence_started_at;
                sequence_id = j.card.sequence_id ?? sequence_id;
                timezone = j.card.timezone ?? timezone;
                responded_at = j.card.responded_at ?? responded_at;
              }
            }
          }

          rows.push({
            id,
            company_id: String(c.company_id ?? ""),
            company_name: String(c.company_name ?? "Company"),
            product_category: canonicalizeCompanyCategory(c.product_category),
            pipeline_stage: String(c.pipeline_stage ?? ""),
            timezone,
            sequence_id,
            sequence_started_at,
            responded_at,
            website_url: c.website_url != null ? String(c.website_url) : null,
            company_website: c.company_website != null ? String(c.company_website) : null,
            potential_athletes: parsePotentialAthletes(c.potential_athletes),
            states,
          });
        })
      );

      rows.sort((a, b) => {
        const ca = categoryKey(a.product_category).toLowerCase();
        const cb = categoryKey(b.product_category).toLowerCase();
        const catCmp = ca.localeCompare(cb);
        if (catCmp !== 0) return catCmp;
        return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" });
      });
      setData({
        sequence: seqJson.sequence ?? null,
        steps,
        rows,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const phases = useMemo(() => {
    if (!data) return [] as [string, SequenceStepDef[]][];
    const map = new Map<string, SequenceStepDef[]>();
    for (const s of data.steps) {
      const list = map.get(s.phase) ?? [];
      list.push(s);
      map.set(s.phase, list);
    }
    return [...map.entries()];
  }, [data]);

  const filterOptions = useMemo(
    () => buildFilterOptionsFromCards(data?.rows ?? []),
    [data]
  );

  const visibleRows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((row) => {
      if (filterDue) {
        const hasDue = data.steps.some((step) => {
          const st = row.states.find((s) => s.step_id === step.id);
          const touch = (st?.touch_status ?? "pending") as TouchStatus;
          return isStepDue(row.sequence_started_at, step.day_offset, touch);
        });
        if (!hasDue) return false;
      }
      if (filterCategory) {
        if (filterCategory === FILTER_UNCATEGORIZED) {
          if (!isEffectivelyUncategorizedCompanyCategory(row.product_category)) return false;
        } else if (categoryKey(row.product_category) !== filterCategory) {
          return false;
        }
      }
      if (filterAthleteId) {
        if (filterAthleteId === FILTER_UNASSIGNED_ATHLETE) {
          if ((row.potential_athletes ?? []).length > 0) return false;
        } else if (!row.potential_athletes.some((p) => p.athlete_id === filterAthleteId)) {
          return false;
        }
      }
      return true;
    });
  }, [data, filterDue, filterCategory, filterAthleteId]);

  const tableColSpan = useMemo(() => {
    if (!data) return 4;
    return 3 + data.steps.reduce((n, s) => n + (s.expects_response ? 2 : 1), 0);
  }, [data]);

  const groupedRows = useMemo(() => {
    const out: Array<
      | { kind: "header"; category: string; count: number }
      | { kind: "row"; row: BoardRow; stripe: number }
    > = [];

    let i = 0;
    while (i < visibleRows.length) {
      const cat = categoryKey(visibleRows[i]!.product_category);
      let j = i + 1;
      while (j < visibleRows.length && categoryKey(visibleRows[j]!.product_category) === cat) {
        j += 1;
      }
      out.push({ kind: "header", category: cat, count: j - i });
      for (let k = i; k < j; k++) {
        out.push({ kind: "row", row: visibleRows[k]!, stripe: k - i });
      }
      i = j;
    }
    return out;
  }, [visibleRows]);

  const postAction = async (cardId: string, body: Record<string, unknown>) => {
    setBusyId(cardId);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const saveTimezone = async (cardId: string, tz: string | null) => {
    setBusyId(cardId);
    try {
      const res = await fetch(`/api/crm/pipeline/${cardId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to save timezone");
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) => (r.id === cardId ? { ...r, timezone: tz } : r)),
            }
          : prev
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <p className="p-8 text-sm text-[#B9B2A6]">Loading sequence board…</p>;
  }

  if (error && !data) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-[#F1A2A2]">{error}</p>
        <Button size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const hasActiveFilters = Boolean(filterDue || filterCategory || filterAthleteId);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#F4F1EB]">Sequence board</h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {data.sequence
              ? `${data.sequence.name} v${data.sequence.version}`
              : "No active sequence"}{" "}
            — click cells to cycle status (gray → green → skipped). R cells track replies.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filterDue ? "secondary" : "outline"}
            onClick={() => setFilterDue((v) => !v)}
          >
            {filterDue ? "Showing due" : "Due today"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
          <Link
            href="/crm"
            className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-sm text-[#D7D0C4] hover:bg-white/5"
          >
            Pipeline
          </Link>
          <Link
            href="/crm/variants"
            className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-sm text-[#D7D0C4] hover:bg-white/5"
          >
            My Variants
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by product category"
          className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All categories</option>
          <option value={FILTER_UNCATEGORIZED}>Uncategorized</option>
          {filterOptions.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by athlete"
          className="min-w-[10rem] rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterAthleteId}
          onChange={(e) => setFilterAthleteId(e.target.value)}
        >
          <option value="">All athletes</option>
          <option value={FILTER_UNASSIGNED_ATHLETE}>Unassigned</option>
          {filterOptions.athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
            onClick={() => {
              setFilterDue(false);
              setFilterCategory("");
              setFilterAthleteId("");
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="text-xs text-[#8E877A]">
          {visibleRows.length} {visibleRows.length === 1 ? "company" : "companies"}
        </span>
      </div>

      {error && <p className="text-sm text-[#F1A2A2]">{error}</p>}

      <div className="overflow-auto rounded-lg border border-white/10">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#151A17]">
              <th className="sticky left-0 z-10 bg-[#151A17] px-3 py-2 text-left text-xs font-semibold text-[#B9B2A6]">
                Company
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold text-[#B9B2A6]">TZ</th>
              {phases.map(([phase, steps]) => (
                <th
                  key={phase}
                  colSpan={steps.reduce((n, s) => n + (s.expects_response ? 2 : 1), 0)}
                  className="border-l border-white/10 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[#8E877A]"
                >
                  {phaseLabel(phase)}
                </th>
              ))}
              <th className="px-2 py-2 text-xs font-semibold text-[#B9B2A6]">Start</th>
            </tr>
            <tr className="bg-[#121614]">
              <th className="sticky left-0 z-10 bg-[#121614] px-3 py-1" />
              <th className="px-2 py-1" />
              {data.steps.map((step) => (
                <th
                  key={step.id}
                  colSpan={step.expects_response ? 2 : 1}
                  className="border-l border-white/5 px-1 py-1 text-center text-[10px] font-medium text-[#B9B2A6]"
                  title={step.action_label}
                >
                  {step.short_code}
                </th>
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {groupedRows.map((item) => {
              if (item.kind === "header") {
                return (
                  <tr key={`cat:${item.category}`} className="bg-[#1A211D]">
                    <td
                      colSpan={tableColSpan}
                      className="sticky left-0 z-10 border-y border-white/10 bg-[#1A211D] px-3 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#DBEEE0]">
                          {item.category}
                        </span>
                        <span className="text-[10px] text-[#8E877A]">
                          {item.count} {item.count === 1 ? "company" : "companies"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              }

              const { row, stripe } = item;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    stripe % 2 === 0 ? "bg-[#0F1311]" : "bg-[#121614]",
                    "hover:bg-[#181E1A]"
                  )}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5">
                    <Link
                      href={`/crm?pipeline_id=${row.id}`}
                      className="font-medium text-[#F4F1EB] hover:underline"
                    >
                      {row.company_name}
                    </Link>
                    {row.potential_athletes.length > 0 ? (
                      <div className="text-[10px] text-[#8E877A]">
                        {row.potential_athletes
                          .map((a) => a.name?.trim() || "Athlete")
                          .join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="min-w-[8rem] px-1 py-1">
                    <TimezoneSelect
                      value={row.timezone}
                      websiteHint={row.company_website ?? row.website_url}
                      onChange={(tz) => void saveTimezone(row.id, tz)}
                    />
                  </td>
                  {data.steps.map((step) => {
                    const st = row.states.find((s) => s.step_id === step.id);
                    const touch = (st?.touch_status ?? "pending") as TouchStatus;
                    const resp = (st?.response_status ?? "awaiting") as ResponseStatus;
                    const due = isStepDue(row.sequence_started_at, step.day_offset, touch);
                    const blocked = isStepBlocked(step, data.steps, row.states);
                    const disabled = busyId === row.id || !row.sequence_started_at;

                    return (
                      <td
                        key={step.id}
                        colSpan={step.expects_response ? 2 : 1}
                        className="border-l border-white/5 px-0.5 py-1"
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            disabled={disabled || blocked.blocked}
                            title={
                              blocked.blocked
                                ? blocked.reason ?? "Blocked"
                                : `${step.action_label}${step.guidance ? `\n${step.guidance}` : ""}`
                            }
                            className={cn(
                              "min-w-[2.1rem] rounded px-1.5 py-1 text-[10px] font-semibold",
                              touchClass(touch, due && !blocked.blocked, blocked.blocked)
                            )}
                            onClick={() =>
                              void postAction(row.id, {
                                action: "cycle_touch",
                                card_id: row.id,
                                step_id: step.id,
                              })
                            }
                          >
                            {step.short_code}
                          </button>
                          {step.expects_response && (
                            <button
                              type="button"
                              disabled={disabled}
                              title={`${step.short_code} response`}
                              className={cn(
                                "min-w-[1.4rem] rounded px-1 py-1 text-[9px] font-medium",
                                responseClass(resp)
                              )}
                              onClick={() => {
                                const nextWouldBeResponded = resp === "awaiting";
                                let move = true;
                                if (nextWouldBeResponded) {
                                  move = window.confirm(
                                    `Mark response on ${step.short_code} and move to Negotiating?`
                                  );
                                }
                                void postAction(row.id, {
                                  action: "cycle_response",
                                  card_id: row.id,
                                  step_id: step.id,
                                  move_to_negotiating: move,
                                });
                              }}
                            >
                              R
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1">
                    {!row.sequence_started_at ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[11px]"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void postAction(row.id, { action: "start", card_id: row.id })
                        }
                      >
                        Start
                      </Button>
                    ) : (
                      <span className="text-[10px] text-[#8E877A]">
                        {new Date(row.sequence_started_at).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className="px-4 py-8 text-center text-sm text-[#8E877A]"
                >
                  {hasActiveFilters
                    ? "No companies match these filters."
                    : "No pipeline cards to show. Move brands into Send, then Start sequence."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
