"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cycleResponseStatus,
  cycleTouchStatus,
  isStepBlocked,
  isStepDue,
  phaseLabel,
  sortSequenceSteps,
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
import { SequenceCompanyDetails } from "@/components/crm/SequenceCompanyDetails";
import { ChevronDown } from "lucide-react";
import { normalizePipelineContacts } from "@/lib/crm/pipeline-contacts";

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
  hq_phone?: string | null;
  instagram_handle?: string | null;
  support_email_v2?: string | null;
  pipeline_contacts?: unknown;
  contact_of_record_id: string | null;
  sequence_contact_id: string | null;
  potential_athletes: PotentialAthlete[];
  /** CRM contact names/emails for search */
  contact_names: string[];
  states: CardStepState[];
};

type BoardPayload = {
  sequence: { id: string; name: string; version: number } | null;
  steps: SequenceStepDef[];
  rows: BoardRow[];
};

const UNCATEGORIZED_LABEL = "Uncategorized";
const PAGE_SIZE = 50;
const ACTIVE_STAGES = new Set([
  "outreach",
  "follow_up",
  "bounced",
  "drafting",
  "target",
  "in_progress",
]);

function cardNeedsSequenceFetch(row: Pick<BoardRow, "sequence_started_at" | "pipeline_stage">): boolean {
  return Boolean(row.sequence_started_at) || ["outreach", "follow_up"].includes(row.pipeline_stage);
}
function categoryKey(category: string | null | undefined): string {
  if (isEffectivelyUncategorizedCompanyCategory(category)) return UNCATEGORIZED_LABEL;
  return canonicalizeCompanyCategory(category) ?? UNCATEGORIZED_LABEL;
}

function parsePotentialAthletes(raw: unknown): PotentialAthlete[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): PotentialAthlete[] => {
    if (!p || typeof p !== "object") return [];
    const rec = p as Record<string, unknown>;
    const athlete_id = String(rec.athlete_id ?? "").trim();
    if (!athlete_id) return [];
    const athlete: PotentialAthlete = { athlete_id };
    if (rec.name != null) athlete.name = String(rec.name);
    if (rec.sport != null) athlete.sport = String(rec.sport);
    return [athlete];
  });
}

function pipelineContactNames(raw: unknown): string[] {
  return normalizePipelineContacts(raw)
    .flatMap((c) => [c.name, c.email])
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowMatchesSearch(row: BoardRow, q: string): boolean {
  if (!q) return true;
  if (row.company_name.toLowerCase().includes(q)) return true;
  if (row.potential_athletes.some((a) => (a.name ?? "").toLowerCase().includes(q))) return true;
  if (row.contact_names.some((n) => n.toLowerCase().includes(q))) return true;
  if (pipelineContactNames(row.pipeline_contacts).some((n) => n.toLowerCase().includes(q))) {
    return true;
  }
  return false;
}

function rowFromPipelineCard(c: Record<string, unknown>): BoardRow {
  return {
    id: String(c.id),
    company_id: String(c.company_id ?? ""),
    company_name: String(c.company_name ?? "Company"),
    product_category: canonicalizeCompanyCategory(c.product_category),
    pipeline_stage: String(c.pipeline_stage ?? ""),
    timezone: c.timezone != null ? String(c.timezone) : null,
    sequence_id: c.sequence_id != null ? String(c.sequence_id) : null,
    sequence_started_at: c.sequence_started_at != null ? String(c.sequence_started_at) : null,
    responded_at: c.responded_at != null ? String(c.responded_at) : null,
    website_url: c.website_url != null ? String(c.website_url) : null,
    company_website: c.company_website != null ? String(c.company_website) : null,
    hq_phone: c.hq_phone != null ? String(c.hq_phone) : null,
    instagram_handle: c.instagram_handle != null ? String(c.instagram_handle) : null,
    support_email_v2: c.support_email_v2 != null ? String(c.support_email_v2) : null,
    pipeline_contacts: c.pipeline_contacts,
    contact_of_record_id: c.contact_of_record_id != null ? String(c.contact_of_record_id) : null,
    sequence_contact_id: c.sequence_contact_id != null ? String(c.sequence_contact_id) : null,
    potential_athletes: parsePotentialAthletes(c.potential_athletes),
    contact_names: [],
    states: [],
  };
}

/** Merge per-step state so one API response can't wipe other steps' local clicks. */
function mergeStepStates(
  local: CardStepState[],
  server: CardStepState[],
  prefer: "local" | "server" = "server"
): CardStepState[] {
  if (server.length === 0) return local;
  if (local.length === 0) return server;

  const localMap = new Map(local.map((s) => [s.step_id, s]));
  const serverMap = new Map(server.map((s) => [s.step_id, s]));
  const stepIds = new Set([...localMap.keys(), ...serverMap.keys()]);

  return [...stepIds].map((stepId) => {
    const l = localMap.get(stepId);
    const s = serverMap.get(stepId);
    if (!l) return s!;
    if (!s) return l;
    return prefer === "local" ? { ...s, ...l } : { ...l, ...s };
  });
}

type PendingStepEdit = { touch?: TouchStatus; response?: ResponseStatus };

function overlayPendingStepEdits(
  cardId: string,
  states: CardStepState[],
  pending: Map<string, PendingStepEdit>
): CardStepState[] {
  if (pending.size === 0) return states;
  return states.map((s) => {
    const edit = pending.get(`${cardId}:${s.step_id}`);
    if (!edit) return s;
    return {
      ...s,
      ...(edit.touch !== undefined
        ? {
            touch_status: edit.touch,
            done_at:
              edit.touch === "pending" ? null : (s.done_at ?? new Date().toISOString()),
          }
        : {}),
      ...(edit.response !== undefined ? { response_status: edit.response } : {}),
    };
  });
}

function upsertStepState(states: CardStepState[], next: CardStepState): CardStepState[] {
  const idx = states.findIndex((s) => s.step_id === next.step_id);
  if (idx >= 0) {
    const copy = states.slice();
    copy[idx] = { ...copy[idx]!, ...next };
    return copy;
  }
  return [...states, next];
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

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#B9B2A6]">
      <span
        className={cn(
          "inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded px-1 text-[9px] font-semibold",
          className
        )}
        aria-hidden
      >
        ·
      </span>
      {label}
    </span>
  );
}

function SequenceColorKey() {
  return (
    <div className="rounded-lg border border-white/10 bg-[#121614] px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8E877A]">
          Key
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[10px] text-[#5E574C]">Touch</span>
          <LegendSwatch className="bg-[#1E2420] text-[#8E877A]" label="Pending" />
          <LegendSwatch
            className="bg-[#3A3420] text-[#F4E8C0] ring-2 ring-amber-400/70"
            label="Due today"
          />
          <LegendSwatch className="bg-[#2F5D3A] text-[#E8F6ED]" label="Done" />
          <LegendSwatch className="bg-[#3A3A42] text-[#B9B2A6]" label="Skipped" />
          <LegendSwatch className="bg-[#2A2A2A] text-[#6E6E6E]" label="Blocked" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[10px] text-[#5E574C]">R (reply)</span>
          <LegendSwatch
            className="border border-dashed border-white/10 bg-[#151A17] text-[#5E574C]"
            label="Awaiting"
          />
          <LegendSwatch className="bg-[#2F5D3A] text-[#E8F6ED]" label="Responded" />
          <LegendSwatch className="bg-[#6B2E2E] text-[#F1A2A2]" label="No response" />
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-[#5E574C]">
        Click a touch cell to cycle pending → done → skipped. Click R to cycle awaiting → responded →
        no response (responded updates pipeline stage in place). Colors update instantly.
      </p>
    </div>
  );
}

export function SequenceBoard() {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterDue, setFilterDue] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAthleteId, setFilterAthleteId] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterListId, setFilterListId] = useState("");
  const [crmLists, setCrmLists] = useState<{ id: string; name: string; company_ids: string[] }[]>([]);
  const [page, setPage] = useState(1);
  const [enriching, setEnriching] = useState(false);
  const [enrichedTick, setEnrichedTick] = useState(0);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const enrichedIdsRef = useRef<Set<string>>(new Set());
  const enrichInFlightRef = useRef<Set<string>>(new Set());
  /** Per card+step generation so stale API responses don't overwrite newer optimistic clicks. */
  const actionGenRef = useRef<Map<string, number>>(new Map());
  /** Bumped on local touch/R edits so late enrich fetches can't revert the UI. */
  const rowMutationGenRef = useRef<Map<string, number>>(new Map());
  /** Holds optimistic touch/R until the matching POST finishes. */
  const pendingStepEditsRef = useRef<Map<string, PendingStepEdit>>(new Map());
  const searchParams = useSearchParams();

  const goToFirstPage = () => {
    setPage(1);
    setExpandedCompanyId(null);
  };

  const bumpRowMutation = (cardId: string) => {
    const gen = (rowMutationGenRef.current.get(cardId) ?? 0) + 1;
    rowMutationGenRef.current.set(cardId, gen);
    return gen;
  };

  const dataRef = useRef<BoardPayload | null>(null);
  dataRef.current = data;
  const enrichRowsRef = useRef<(rows: BoardRow[]) => Promise<void>>(async () => {});

  const applyEnrichment = useCallback((updates: BoardRow[]) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u]));
    for (const id of byId.keys()) enrichedIdsRef.current.add(id);
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          const next = byId.get(r.id);
          return next ? { ...r, ...next } : r;
        }),
      };
    });
    setEnrichedTick((n) => n + 1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    enrichedIdsRef.current = new Set();
    enrichInFlightRef.current = new Set();
    rowMutationGenRef.current = new Map();
    pendingStepEditsRef.current = new Map();
    try {
      const [seqRes, pipeRes] = await Promise.all([
        fetch("/api/crm/sequence", { credentials: "include" }),
        fetch("/api/crm/pipeline", { credentials: "include" }),
      ]);
      const seqJson = await seqRes.json().catch(() => ({}));
      const pipeJson = await pipeRes.json().catch(() => ({}));
      if (!seqRes.ok) throw new Error(seqJson.error ?? "Failed to load sequence");
      if (!pipeRes.ok) throw new Error(pipeJson.error ?? "Failed to load pipeline");

      const steps = sortSequenceSteps((seqJson.steps ?? []) as SequenceStepDef[]);
      const cards = (pipeJson.cards ?? pipeJson.pipeline ?? []) as Array<Record<string, unknown>>;

      const rows = cards
        .filter((c) => !c.archived && ACTIVE_STAGES.has(String(c.pipeline_stage ?? "")))
        .map(rowFromPipelineCard);

      rows.sort((a, b) => {
        const ca = categoryKey(a.product_category).toLowerCase();
        const cb = categoryKey(b.product_category).toLowerCase();
        const catCmp = ca.localeCompare(cb);
        if (catCmp !== 0) return catCmp;
        return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" });
      });

      const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
      if (companyIds.length > 0) {
        try {
          const namesRes = await fetch("/api/crm/companies/contact-names", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_ids: companyIds }),
          });
          const namesJson = await namesRes.json().catch(() => ({}));
          if (namesRes.ok && namesJson.by_company_id) {
            const byCompany = namesJson.by_company_id as Record<string, string[]>;
            for (const row of rows) {
              row.contact_names = Array.isArray(byCompany[row.company_id])
                ? byCompany[row.company_id]!
                : [];
            }
          }
        } catch {
          /* search still works for company/athlete without contact names */
        }
      }

      setData({
        sequence: seqJson.sequence ?? null,
        steps,
        rows,
      });
      setEnrichedTick((n) => n + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/crm/lists", { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setCrmLists(
            ((json.lists ?? []) as Array<{ id: string; name: string; company_ids?: string[] }>).map(
              (l) => ({
                id: l.id,
                name: l.name,
                company_ids: l.company_ids ?? [],
              })
            )
          );
        }
      } catch {
        /* lists filter optional */
      }
    })();
  }, []);

  useEffect(() => {
    const fromUrl = searchParams.get("list")?.trim() ?? "";
    if (fromUrl) {
      setFilterListId(fromUrl);
      goToFirstPage();
    }
  }, [searchParams]);

  const listCompanyIds = useMemo(() => {
    if (!filterListId) return null;
    const list = crmLists.find((l) => l.id === filterListId);
    if (!list) return null;
    return new Set(list.company_ids);
  }, [filterListId, crmLists]);

  const enrichRows = useCallback(async (rows: BoardRow[]) => {
    const toFetch: BoardRow[] = [];
    for (const row of rows) {
      if (enrichedIdsRef.current.has(row.id) || enrichInFlightRef.current.has(row.id)) continue;
      if (!cardNeedsSequenceFetch(row)) {
        enrichedIdsRef.current.add(row.id);
        continue;
      }
      enrichInFlightRef.current.add(row.id);
      toFetch.push(row);
    }
    if (toFetch.length === 0) return;

    setEnriching(true);
    try {
      const updates = new Map<string, BoardRow>();
      await Promise.all(
        toFetch.map(async (row) => {
          const fetchGen = rowMutationGenRef.current.get(row.id) ?? 0;
          try {
            const r = await fetch(`/api/crm/sequence?card_id=${encodeURIComponent(row.id)}`, {
              credentials: "include",
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok) {
              const currentGen = rowMutationGenRef.current.get(row.id) ?? 0;
              if (currentGen !== fetchGen) {
                return;
              }
              const liveRow = dataRef.current?.rows.find((r) => r.id === row.id);
              const localStates = liveRow?.states ?? row.states;
              updates.set(row.id, {
                ...(liveRow ?? row),
                states: overlayPendingStepEdits(
                  row.id,
                  mergeStepStates(
                    localStates,
                    (j.states ?? []) as CardStepState[],
                    "server"
                  ),
                  pendingStepEditsRef.current
                ),
                sequence_started_at: j.card?.sequence_started_at ?? row.sequence_started_at,
                sequence_id: j.card?.sequence_id ?? row.sequence_id,
                timezone: j.card?.timezone ?? row.timezone,
                responded_at: j.card?.responded_at ?? row.responded_at,
              });
            }
          } finally {
            enrichInFlightRef.current.delete(row.id);
            if (updates.has(row.id)) {
              enrichedIdsRef.current.add(row.id);
            }
          }
        })
      );
      if (updates.size > 0) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                rows: prev.rows.map((r) => updates.get(r.id) ?? r),
              }
            : prev
        );
        setEnrichedTick((t) => t + 1);
      }
    } finally {
      setEnriching(false);
    }
  }, []);
  enrichRowsRef.current = enrichRows;

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

  const baseFilteredRows = useMemo(() => {
    if (!data) return [];
    const q = filterSearch.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (listCompanyIds && listCompanyIds.size > 0) {
        if (!row.company_id || !listCompanyIds.has(row.company_id)) return false;
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
      if (q && !rowMatchesSearch(row, q)) return false;
      return true;
    });
  }, [data, filterCategory, filterAthleteId, filterSearch, listCompanyIds]);

  const filterKey = `${filterDue}|${filterCategory}|${filterAthleteId}|${filterListId}|${filterSearch}`;

  useEffect(() => {
    goToFirstPage();
  }, [filterKey]);

  useEffect(() => {
    if (!filterDue) return;
    void enrichRows(baseFilteredRows);
  }, [filterDue, baseFilteredRows, enrichRows]);

  const dueFilterReady = useMemo(() => {
    if (!filterDue) return true;
    return baseFilteredRows.every(
      (row) => !cardNeedsSequenceFetch(row) || enrichedIdsRef.current.has(row.id)
    );
    // enrichedTick forces recompute after enrichments land
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDue, baseFilteredRows, enrichedTick]);

  const visibleRows = useMemo(() => {
    if (!filterDue) return baseFilteredRows;
    if (!data || !dueFilterReady) return [];
    return baseFilteredRows.filter((row) =>
      data.steps.some((step) => {
        const st = row.states.find((s) => s.step_id === step.id);
        const touch = (st?.touch_status ?? "pending") as TouchStatus;
        return isStepDue(step, data.steps, row.states, row.sequence_started_at, touch);
      })
    );
  }, [baseFilteredRows, filterDue, data, dueFilterReady]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rangeStart = visibleRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, visibleRows.length);
  const pageRows = useMemo(
    () => visibleRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleRows, safePage]
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setExpandedCompanyId(null);
  }, [safePage]);

  useEffect(() => {
    void enrichRows(pageRows);
  }, [pageRows, enrichRows]);

  const tableColSpan = useMemo(() => {
    if (!data) return 4;
    return 3 + data.steps.reduce((n, s) => n + (s.expects_response ? 2 : 1), 0);
  }, [data]);

  const categoryTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of visibleRows) {
      const cat = categoryKey(row.product_category);
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return counts;
  }, [visibleRows]);

  const groupedRows = useMemo(() => {
    const out: Array<
      | { kind: "header"; category: string; count: number }
      | { kind: "row"; row: BoardRow; stripe: number }
    > = [];

    let i = 0;
    while (i < pageRows.length) {
      const cat = categoryKey(pageRows[i]!.product_category);
      let j = i + 1;
      while (j < pageRows.length && categoryKey(pageRows[j]!.product_category) === cat) {
        j += 1;
      }
      out.push({ kind: "header", category: cat, count: categoryTotals.get(cat) ?? j - i });
      for (let k = i; k < j; k++) {
        out.push({ kind: "row", row: pageRows[k]!, stripe: k - i });
      }
      i = j;
    }
    return out;
  }, [pageRows, categoryTotals]);

  const applyCardActionResult = useCallback((cardId: string, json: Record<string, unknown>) => {
    setData((prev) => {
      if (!prev) return prev;
      if (json.dropped_company) {
        return {
          ...prev,
          rows: prev.rows.filter((r) => r.id !== cardId),
        };
      }
      const stage = json.pipeline_stage != null ? String(json.pipeline_stage) : null;
      if (stage === "ghost" || (stage && !ACTIVE_STAGES.has(stage))) {
        return {
          ...prev,
          rows: prev.rows.filter((r) => r.id !== cardId),
        };
      }
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          if (r.id !== cardId) return r;

          let states = r.states;
          if (json.state && typeof json.state === "object") {
            const st = json.state as CardStepState;
            const merged: CardStepState = {
              ...st,
              ...(json.touch_status
                ? { touch_status: String(json.touch_status) as TouchStatus }
                : {}),
              ...(json.response_status
                ? { response_status: String(json.response_status) as ResponseStatus }
                : {}),
            };
            states = upsertStepState(states, merged);
          } else if (Array.isArray(json.states)) {
            states = mergeStepStates(r.states, json.states as CardStepState[], "local");
          }
          states = overlayPendingStepEdits(cardId, states, pendingStepEditsRef.current);

          return {
            ...r,
            states,
            sequence_id:
              json.sequence_id != null ? String(json.sequence_id) : r.sequence_id,
            sequence_started_at:
              Object.prototype.hasOwnProperty.call(json, "sequence_started_at")
                ? json.sequence_started_at != null
                  ? String(json.sequence_started_at)
                  : null
                : r.sequence_started_at,
            responded_at:
              json.responded_at !== undefined
                ? json.responded_at != null
                  ? String(json.responded_at)
                  : null
                : r.responded_at,
            pipeline_stage:
              stage ?? (json.moved_to_negotiating ? "in_progress" : r.pipeline_stage),
            sequence_contact_id:
              Object.prototype.hasOwnProperty.call(json, "sequence_contact_id")
                ? json.sequence_contact_id != null
                  ? String(json.sequence_contact_id)
                  : null
                : r.sequence_contact_id,
            contact_of_record_id:
              Object.prototype.hasOwnProperty.call(json, "contact_of_record_id")
                ? json.contact_of_record_id != null
                  ? String(json.contact_of_record_id)
                  : null
                : r.contact_of_record_id,
          };
        }),
      };
    });
    enrichedIdsRef.current.add(cardId);
    setEnrichedTick((n) => n + 1);

    if (json.dropped_company) {
      setError(null);
      setExpandedCompanyId((id) => (id === cardId ? null : id));
    } else if (json.moved_to_ghost) {
      setError(null);
      setExpandedCompanyId((id) => (id === cardId ? null : id));
    } else if (json.moved_to_bounced) {
      setError("Contact bounced — pick another contact (or Find new contact on the pipeline card).");
      setExpandedCompanyId(cardId);
    } else if (json.needs_next_contact) {
      setError("Sequence finished for this contact — pick the next contact to continue.");
      setExpandedCompanyId(cardId);
    }
  }, []);

  const postAction = async (
    cardId: string,
    body: Record<string, unknown>,
    opts?: { genKey?: string; gen?: number }
  ) => {
    setError(null);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed");

      // Drop stale responses when the user already clicked ahead on this cell.
      if (
        opts?.genKey != null &&
        opts.gen != null &&
        actionGenRef.current.get(opts.genKey) !== opts.gen
      ) {
        return;
      }

      const stepId = body.step_id != null ? String(body.step_id).trim() : "";
      if (stepId) pendingStepEditsRef.current.delete(`${cardId}:${stepId}`);

      applyCardActionResult(cardId, json as Record<string, unknown>);
    } catch (e: unknown) {
      if (
        opts?.genKey != null &&
        opts.gen != null &&
        actionGenRef.current.get(opts.genKey) !== opts.gen
      ) {
        return;
      }
      const stepId = body.step_id != null ? String(body.step_id).trim() : "";
      if (stepId) pendingStepEditsRef.current.delete(`${cardId}:${stepId}`);
      setError(e instanceof Error ? e.message : "Failed");
      try {
        const r = await fetch(`/api/crm/sequence?card_id=${encodeURIComponent(cardId)}`, {
          credentials: "include",
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          applyCardActionResult(cardId, {
            states: mergeStepStates(
              dataRef.current?.rows.find((r) => r.id === cardId)?.states ?? [],
              (j.states ?? []) as CardStepState[],
              "server"
            ),
            sequence_started_at: j.card?.sequence_started_at,
            sequence_id: j.card?.sequence_id,
            responded_at: j.card?.responded_at,
          });
        }
      } catch {
        /* ignore secondary refresh errors */
      }
    }
  };

  const cycleTouch = (cardId: string, stepId: string) => {
    bumpRowMutation(cardId);
    let next: TouchStatus = "done";
    let startedAt: string | null = null;

    setData((prev) => {
      if (!prev) return prev;
      const row = prev.rows.find((r) => r.id === cardId);
      if (!row) return prev;
      const st = row.states.find((s) => s.step_id === stepId);
      const current = (st?.touch_status ?? "pending") as TouchStatus;
      next = cycleTouchStatus(current);
      startedAt = row.sequence_started_at ?? new Date().toISOString();

      const idx = row.states.findIndex((s) => s.step_id === stepId);
      let states = row.states;
      if (idx >= 0) {
        states = states.slice();
        states[idx] = {
          ...states[idx]!,
          touch_status: next,
          done_at: next === "pending" ? null : new Date().toISOString(),
        };
      } else {
        states = [
          ...row.states,
          {
            card_id: cardId,
            step_id: stepId,
            touch_status: next,
            response_status: "awaiting",
            done_at: next === "pending" ? null : new Date().toISOString(),
            variant_id: null,
            outcome: null,
            notes: null,
          },
        ];
      }

      return {
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === cardId
            ? { ...r, states, sequence_started_at: startedAt }
            : r
        ),
      };
    });

    enrichedIdsRef.current.add(cardId);
    setEnrichedTick((n) => n + 1);

    pendingStepEditsRef.current.set(`${cardId}:${stepId}`, { touch: next });

    const genKey = `${cardId}:${stepId}:touch`;
    const gen = (actionGenRef.current.get(genKey) ?? 0) + 1;
    actionGenRef.current.set(genKey, gen);
    void postAction(
      cardId,
      {
        action: "set_touch",
        card_id: cardId,
        step_id: stepId,
        touch_status: next,
      },
      { genKey, gen }
    );
  };

  const cycleResponse = (cardId: string, step: SequenceStepDef) => {
    bumpRowMutation(cardId);
    let next: ResponseStatus = "responded";
    let moveToNegotiating = false;

    setData((prev) => {
      if (!prev) return prev;
      const row = prev.rows.find((r) => r.id === cardId);
      if (!row) return prev;
      const st = row.states.find((s) => s.step_id === step.id);
      const current = (st?.response_status ?? "awaiting") as ResponseStatus;
      next = cycleResponseStatus(current);
      moveToNegotiating = next === "responded";

      const idx = row.states.findIndex((s) => s.step_id === step.id);
      let states = row.states;
      if (idx >= 0) {
        states = states.slice();
        states[idx] = { ...states[idx]!, response_status: next };
      } else {
        states = [
          ...row.states,
          {
            card_id: cardId,
            step_id: step.id,
            touch_status: "pending",
            response_status: next,
            done_at: null,
            variant_id: null,
            outcome: null,
            notes: null,
          },
        ];
      }

      return {
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === cardId
            ? {
                ...r,
                states,
                pipeline_stage: moveToNegotiating ? "in_progress" : r.pipeline_stage,
                responded_at: moveToNegotiating ? new Date().toISOString() : r.responded_at,
              }
            : r
        ),
      };
    });

    enrichedIdsRef.current.add(cardId);
    setEnrichedTick((n) => n + 1);

    pendingStepEditsRef.current.set(`${cardId}:${step.id}`, { response: next });

    const genKey = `${cardId}:${step.id}:response`;
    const gen = (actionGenRef.current.get(genKey) ?? 0) + 1;
    actionGenRef.current.set(genKey, gen);
    void postAction(
      cardId,
      {
        action: "set_response",
        card_id: cardId,
        step_id: step.id,
        response_status: next,
        move_to_negotiating: moveToNegotiating,
      },
      { genKey, gen }
    );
  };

  const saveTimezone = async (cardId: string, tz: string | null) => {
    // Optimistic — don't lock the row
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) => (r.id === cardId ? { ...r, timezone: tz } : r)),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/crm/pipeline/${cardId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to save timezone");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveRowContacts = (
    cardId: string,
    patch: { contact_of_record_id?: string | null; sequence_contact_id?: string | null }
  ) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.id === cardId
                ? {
                    ...r,
                    contact_of_record_id:
                      patch.contact_of_record_id !== undefined
                        ? patch.contact_of_record_id
                        : r.contact_of_record_id,
                    sequence_contact_id:
                      patch.sequence_contact_id !== undefined
                        ? patch.sequence_contact_id
                        : r.sequence_contact_id,
                  }
                : r
            ),
          }
        : prev
    );
  };

  const saveRowCompanyInfo = (
    cardId: string,
    patch: {
      hq_phone?: string | null;
      instagram_handle?: string | null;
      support_email_v2?: string | null;
    }
  ) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.id === cardId
                ? {
                    ...r,
                    hq_phone: patch.hq_phone !== undefined ? patch.hq_phone : r.hq_phone,
                    instagram_handle:
                      patch.instagram_handle !== undefined
                        ? patch.instagram_handle
                        : r.instagram_handle,
                    support_email_v2:
                      patch.support_email_v2 !== undefined
                        ? patch.support_email_v2
                        : r.support_email_v2,
                  }
                : r
            ),
          }
        : prev
    );
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

  const hasActiveFilters = Boolean(
    filterDue || filterCategory || filterAthleteId || filterListId || filterSearch.trim()
  );
  const showDueLoading = filterDue && !dueFilterReady;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#F4F1EB]">Sequence board</h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {data.sequence
              ? `${data.sequence.name} v${data.sequence.version}`
              : "No active sequence"}{" "}
            — click cells to cycle pending → done → skipped. R cycles awaiting → responded →
            no response (responded also updates Negotiating on the pipeline). Updates are instant. First
            click starts the cadence clock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filterDue ? "secondary" : "outline"}
            onClick={() => {
              setFilterDue((v) => !v);
              goToFirstPage();
            }}
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
        <input
          type="search"
          aria-label="Search companies, athletes, or contacts"
          placeholder="Search company, athlete, or contact…"
          className="min-w-[12rem] flex-1 rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF] placeholder:text-[#5E574C] sm:max-w-[16rem] sm:flex-none"
          value={filterSearch}
          onChange={(e) => {
            setFilterSearch(e.target.value);
            goToFirstPage();
          }}
        />
        <select
          aria-label="Filter by CRM list"
          className="min-w-[10rem] rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterListId}
          onChange={(e) => {
            setFilterListId(e.target.value);
            goToFirstPage();
          }}
        >
          <option value="">All lists</option>
          {crmLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by product category"
          className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterCategory}
          onChange={(e) => {
            setFilterCategory(e.target.value);
            goToFirstPage();
          }}
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
          onChange={(e) => {
            setFilterAthleteId(e.target.value);
            goToFirstPage();
          }}
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
              setFilterListId("");
              setFilterSearch("");
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="text-xs text-[#8E877A]">
          {showDueLoading
            ? "Loading due…"
            : visibleRows.length === 0
              ? "0 companies"
              : `${rangeStart}–${rangeEnd} of ${visibleRows.length} ${
                  visibleRows.length === 1 ? "company" : "companies"
                }`}
          {enriching && !showDueLoading ? " · loading steps…" : ""}
        </span>
      </div>

      <SequenceColorKey />

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
              <th className="px-2 py-2 text-xs font-semibold text-[#B9B2A6]">Started</th>
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
            {showDueLoading ? (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className="px-4 py-8 text-center text-sm text-[#8E877A]"
                >
                  Loading due steps…
                </td>
              </tr>
            ) : (
              groupedRows.map((item) => {
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
                const expanded = expandedCompanyId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={cn(
                        stripe % 2 === 0 ? "bg-[#0F1311]" : "bg-[#121614]",
                        "hover:bg-[#181E1A]",
                        expanded && "bg-[#181E1A]"
                      )}
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5">
                        <button
                          type="button"
                          className="group flex max-w-full items-start gap-1.5 text-left"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedCompanyId((id) => (id === row.id ? null : row.id))
                          }
                        >
                          <ChevronDown
                            className={cn(
                              "mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E877A] transition-transform",
                              expanded && "rotate-180 text-[#CEE4D4]"
                            )}
                            aria-hidden
                          />
                          <span>
                            <span className="font-medium text-[#F4F1EB] group-hover:underline">
                              {row.company_name}
                            </span>
                            {row.potential_athletes.length > 0 ? (
                              <span className="mt-0.5 block text-[10px] text-[#8E877A]">
                                {row.potential_athletes
                                  .map((a) => a.name?.trim() || "Athlete")
                                  .join(", ")}
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "mt-0.5 block text-[10px]",
                                row.sequence_contact_id || row.contact_of_record_id
                                  ? "text-[#9FD4A8]"
                                  : "text-amber-400/80"
                              )}
                            >
                              {row.sequence_contact_id || row.contact_of_record_id
                                ? "Contact assigned"
                                : "Set contact ↓"}
                            </span>
                          </span>
                        </button>
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
                        const due = isStepDue(
                      step,
                      data.steps,
                      row.states,
                      row.sequence_started_at,
                      touch
                    );
                        const blocked = isStepBlocked(step, data.steps, row.states);

                        return (
                          <td
                            key={step.id}
                            colSpan={step.expects_response ? 2 : 1}
                            className="border-l border-white/5 px-0.5 py-1"
                          >
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                type="button"
                                disabled={blocked.blocked}
                                title={
                                  blocked.blocked
                                    ? blocked.reason ?? "Blocked"
                                    : `${step.action_label}${step.guidance ? `\n${step.guidance}` : ""}`
                                }
                                className={cn(
                                  "min-w-[2.1rem] rounded px-1.5 py-1 text-[10px] font-semibold",
                                  touchClass(touch, due && !blocked.blocked, blocked.blocked)
                                )}
                                onClick={() => cycleTouch(row.id, step.id)}
                              >
                                {step.short_code}
                              </button>
                              {step.expects_response && (
                                <button
                                  type="button"
                                  title={`${step.short_code} response`}
                                  className={cn(
                                    "min-w-[1.4rem] rounded px-1 py-1 text-[9px] font-medium",
                                    responseClass(resp)
                                  )}
                                  onClick={() => cycleResponse(row.id, step)}
                                >
                                  R
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1">
                        <span className="text-[10px] text-[#8E877A]">
                          {row.sequence_started_at
                            ? new Date(row.sequence_started_at).toLocaleDateString()
                            : "—"}
                        </span>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-[#0C100E]">
                        <td colSpan={tableColSpan} className="p-0">
                          <SequenceCompanyDetails
                            row={row}
                            onContactsSaved={(patch) => saveRowContacts(row.id, patch)}
                            onCompanyInfoSaved={(patch) => saveRowCompanyInfo(row.id, patch)}
                            onLifecycle={(patch) =>
                              applyCardActionResult(row.id, patch as Record<string, unknown>)
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
            {!showDueLoading && visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={tableColSpan}
                  className="px-4 py-8 text-center text-sm text-[#8E877A]"
                >
                  {hasActiveFilters
                    ? "No companies match these filters."
                    : "No pipeline cards to show. Move brands into Send, then click a step to begin."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E877A]">
          <p>
            Page {safePage} of {pageCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage <= 1}
              onClick={() => {
                setExpandedCompanyId(null);
                setPage((p) => Math.max(1, p - 1));
              }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={safePage >= pageCount}
              onClick={() => {
                setExpandedCompanyId(null);
                setPage((p) => Math.min(pageCount, p + 1));
              }}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}