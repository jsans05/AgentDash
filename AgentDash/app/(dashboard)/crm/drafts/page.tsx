"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  STAGE_LABEL,
  timeAgo,
  type PipelineCard,
  type PipelineDraftMessage,
  type PipelineStage,
} from "@/components/crm/CrmPipelineKanban";
import {
  buildFilterOptionsFromCards,
  comparePipelineCards,
  filterPipelineCards,
  FILTER_UNASSIGNED_ATHLETE,
  FILTER_UNCATEGORIZED,
  type CardForPipelineFilter,
  type PipelineSortKey,
} from "@/lib/crm/pipeline-card-filter-sort";

type ContactDraftListItem = {
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  company_id: string;
  company_name: string;
  pipeline_id: string | null;
  draft: {
    label?: string;
    subject?: string;
    body: string;
    created_at: string;
    athlete_id?: string | null;
  };
};

type PipelineDraftRow = PipelineDraftMessage & {
  pipeline_id: string;
  company_name: string;
  pipeline_stage: PipelineStage;
};

type ContactDraftRow = ContactDraftListItem;

type MergedDraftRow =
  | ({ source: "pipeline" } & PipelineDraftRow)
  | ({ source: "contact" } & ContactDraftRow);

function flattenPipelineDrafts(cards: PipelineCard[]): PipelineDraftRow[] {
  const rows: PipelineDraftRow[] = [];
  for (const c of cards) {
    const list = c.draft_messages;
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (!d || typeof d.body !== "string" || !d.created_at) continue;
      rows.push({
        ...d,
        pipeline_id: c.id,
        company_name: c.company_name,
        pipeline_stage: c.pipeline_stage,
      });
    }
  }
  return rows;
}

function mergeDraftsChronological(pipelineRows: PipelineDraftRow[], contactRows: ContactDraftRow[]): MergedDraftRow[] {
  const merged: MergedDraftRow[] = [
    ...pipelineRows.map((r) => ({ source: "pipeline" as const, ...r })),
    ...contactRows.map((r) => ({ source: "contact" as const, ...r })),
  ];
  merged.sort((a, b) => {
    const ta = a.source === "pipeline" ? a.created_at : a.draft.created_at;
    const tb = b.source === "pipeline" ? b.created_at : b.draft.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  return merged;
}

function buildCardLookups(cards: PipelineCard[]) {
  const byPipelineId = new Map<string, PipelineCard>();
  const byCompanyId = new Map<string, PipelineCard>();
  for (const c of cards) {
    byPipelineId.set(c.id, c);
    if (!byCompanyId.has(c.company_id)) byCompanyId.set(c.company_id, c);
  }
  return { byPipelineId, byCompanyId };
}

function cardForMergedRow(
  row: MergedDraftRow,
  byPipelineId: Map<string, PipelineCard>,
  byCompanyId: Map<string, PipelineCard>
): PipelineCard | undefined {
  if (row.source === "pipeline") return byPipelineId.get(row.pipeline_id);
  if (row.pipeline_id) return byPipelineId.get(row.pipeline_id);
  return byCompanyId.get(row.company_id);
}

function compareMergedDraftRows(
  a: MergedDraftRow,
  b: MergedDraftRow,
  sortKey: PipelineSortKey,
  byPipelineId: Map<string, PipelineCard>,
  byCompanyId: Map<string, PipelineCard>
): number {
  const ca = cardForMergedRow(a, byPipelineId, byCompanyId);
  const cb = cardForMergedRow(b, byPipelineId, byCompanyId);
  const draftTime = (r: MergedDraftRow) =>
    new Date(r.source === "pipeline" ? r.created_at : r.draft.created_at).getTime();
  if (ca && cb) {
    const base = comparePipelineCards(ca, cb, sortKey);
    if (base !== 0) return base;
    return draftTime(b) - draftTime(a);
  }
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return draftTime(b) - draftTime(a);
}

function filterMergedRowsByPipelineCards(
  rows: MergedDraftRow[],
  filteredCards: CardForPipelineFilter[],
  hasActiveFilters: boolean
): MergedDraftRow[] {
  if (!hasActiveFilters) return rows;
  const allowedPid = new Set(filteredCards.map((c) => c.id));
  const allowedCid = new Set(filteredCards.map((c) => c.company_id));
  return rows.filter((r) => {
    if (r.source === "pipeline") return allowedPid.has(r.pipeline_id);
    if (r.pipeline_id && allowedPid.has(r.pipeline_id)) return true;
    return allowedCid.has(r.company_id);
  });
}

function previewText(body: string, max = 160): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

async function markPipelineDraftSent(pipelineId: string, createdAt: string): Promise<void> {
  const res = await fetch(`/api/crm/pipeline/${encodeURIComponent(pipelineId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ mark_draft_sent: createdAt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to mark sent");
}

export default function CrmPipelineDraftsPage() {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [contactDrafts, setContactDrafts] = useState<ContactDraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterSport, setFilterSport] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAthleteId, setFilterAthleteId] = useState("");
  const [sortKey, setSortKey] = useState<PipelineSortKey>("updated");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/drafts", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load drafts");
      setCards(Array.isArray(data.cards) ? data.cards : []);
      setContactDrafts(Array.isArray(data.contact_drafts) ? data.contact_drafts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setCards([]);
      setContactDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkSent = useCallback(
    async (pipelineId: string, createdAt: string, rowKey: string) => {
      setMarkingKey(rowKey);
      setError(null);
      try {
        await markPipelineDraftSent(pipelineId, createdAt);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to mark sent");
      } finally {
        setMarkingKey(null);
      }
    },
    [load]
  );

  const filterOptions = useMemo(() => buildFilterOptionsFromCards(cards), [cards]);
  const filteredCards = useMemo(
    () => filterPipelineCards(cards, { filterSport, filterCategory, filterAthleteId }),
    [cards, filterSport, filterCategory, filterAthleteId]
  );
  const hasActiveFilters = Boolean(filterSport || filterCategory || filterAthleteId);

  const pipelineRows = useMemo(() => flattenPipelineDrafts(cards), [cards]);
  const mergedChronological = useMemo(
    () => mergeDraftsChronological(pipelineRows, contactDrafts),
    [pipelineRows, contactDrafts]
  );

  const { byPipelineId, byCompanyId } = useMemo(() => buildCardLookups(cards), [cards]);

  const visibleRows = useMemo(
    () => filterMergedRowsByPipelineCards(mergedChronological, filteredCards, hasActiveFilters),
    [mergedChronological, filteredCards, hasActiveFilters]
  );

  const mergedRows = useMemo(() => {
    const copy = [...visibleRows];
    copy.sort((a, b) => compareMergedDraftRows(a, b, sortKey, byPipelineId, byCompanyId));
    return copy;
  }, [visibleRows, sortKey, byPipelineId, byCompanyId]);

  if (loading) {
    return (
      <div className="min-h-0 flex flex-col rounded-xl border border-white/10 bg-[#0F1311]">
        <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
          <h1 className="text-lg font-semibold text-[#F4F1EB]">Pipeline drafts</h1>
          <p className="text-sm text-[#B9B2A6]">Loading…</p>
        </div>
      </div>
    );
  }

  const pipelineCount = pipelineRows.length;
  const contactDraftCount = contactDrafts.length;

  return (
    <div className="mx-auto min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
        <h1 className="text-lg font-semibold text-[#F4F1EB]">Pipeline drafts</h1>
        <p className="text-sm text-[#B9B2A6]">
          {pipelineCount} draft{pipelineCount === 1 ? "" : "s"} on pipeline cards
          {contactDraftCount > 0
            ? ` and ${contactDraftCount} on CRM contacts for those companies.`
            : ". Contact-level drafts show here when chat saves include a contact."}{" "}
          Use the same filters as the Pipeline board; contact drafts follow the company&apos;s pipeline card when
          filters are on.
        </p>
        {error && <p className="mt-1 text-sm text-[#F1A2A2]">{error}</p>}
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#141916] px-4 py-2 text-sm">
        <span className="mr-1 text-[#B9B2A6]">Filter</span>
        <select
          aria-label="Filter by sport"
          className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterSport}
          onChange={(e) => setFilterSport(e.target.value)}
        >
          <option value="">All sports</option>
          {filterOptions.sports.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
          aria-label="Filter by potential athlete"
          className="min-w-[10rem] rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={filterAthleteId}
          onChange={(e) => setFilterAthleteId(e.target.value)}
        >
          <option value="">All athletes</option>
          <option value={FILTER_UNASSIGNED_ATHLETE}>Unassigned (no athlete)</option>
          {filterOptions.athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {(filterSport || filterCategory || filterAthleteId) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
            onClick={() => {
              setFilterSport("");
              setFilterCategory("");
              setFilterAthleteId("");
            }}
          >
            Clear filters
          </Button>
        )}
        <span className="hidden text-white/20 sm:inline">|</span>
        <span className="mr-1 text-[#B9B2A6]">Sort</span>
        <select
          aria-label="Sort draft list"
          className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as PipelineSortKey)}
        >
          <option value="updated">Last updated (card)</option>
          <option value="company">Company A–Z</option>
          <option value="sport">Sport</option>
          <option value="category">Product category</option>
          <option value="athlete">Potential athlete</option>
        </select>
      </div>

      <div className="mt-4 space-y-3 px-4 pb-8">
        {hasActiveFilters && mergedRows.length === 0 && mergedChronological.length > 0 ? (
          <p className="text-sm text-[#B9B2A6]">No drafts match these filters.</p>
        ) : mergedRows.length === 0 ? (
          <p className="text-sm text-[#B9B2A6]">
            No drafts yet. Save from the Drafting tab on a pipeline card, or push saves to CRM contacts from pipeline
            chat.
          </p>
        ) : (
          mergedRows.map((r, i) => {
            if (r.source === "pipeline") {
              const key = `p-${r.pipeline_id}-${r.created_at}-${i}`;
              const open = expanded === key;
              return (
                <article
                  key={key}
                  className="overflow-hidden rounded-lg border border-white/10 bg-[#171D1A] shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="secondary" className="shrink-0 border border-white/10 bg-[#202723] text-[10px] text-[#D7D0C4]">
                          Pipeline
                        </Badge>
                        <Link
                          href={`/crm?open=${encodeURIComponent(r.pipeline_id)}`}
                          className="max-w-[16rem] truncate font-semibold text-[#CEE4D4] hover:underline sm:max-w-xs"
                        >
                          {r.company_name || "Company"}
                        </Link>
                        <span className="rounded-full bg-[#202723] px-2 py-0.5 text-xs text-[#B9B2A6]">
                          {STAGE_LABEL[r.pipeline_stage] ?? r.pipeline_stage}
                        </span>
                        <span className="text-xs text-[#8E877A]">{timeAgo(r.created_at)}</span>
                      </div>
                      {r.label && <p className="mt-1 text-xs text-[#AEA79A]">{r.label}</p>}
                      {r.subject && <p className="mt-1 text-sm font-medium text-[#ECE7DF]">{r.subject}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!r.sent_at && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={markingKey === key}
                          onClick={() => void handleMarkSent(r.pipeline_id, r.created_at, key)}
                        >
                          {markingKey === key ? "Saving…" : "Mark sent"}
                        </Button>
                      )}
                      {r.sent_at && (
                        <span className="text-xs text-[#7FA88A]">
                          Sent {new Date(r.sent_at).toLocaleDateString()}
                        </span>
                      )}
                      <button
                        type="button"
                        className="text-xs font-medium text-[#CEE4D4] hover:underline"
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        {open ? "Hide body" : "Show body"}
                      </button>
                      <Link
                        href={`/crm?open=${encodeURIComponent(r.pipeline_id)}`}
                        className="text-xs font-medium text-[#B9B2A6] hover:underline"
                      >
                        Open card
                      </Link>
                    </div>
                  </div>
                  <div className="bg-[#121713] px-4 py-2 text-sm text-[#CFC8BC]">
                    {open ? (
                      <pre className="whitespace-pre-wrap font-sans text-sm text-[#ECE7DF]">{r.body}</pre>
                    ) : (
                      <p className="italic">{previewText(r.body)}</p>
                    )}
                  </div>
                </article>
              );
            }

            const d = r.draft;
            const key = `c-${r.contact_id}-${d.created_at}-${i}`;
            const open = expanded === key;
            return (
              <article
                key={key}
                className="overflow-hidden rounded-lg border border-white/10 bg-[#171D1A] shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline" className="shrink-0 border-[#5D486C] text-[10px] text-[#D9C7E5]">
                        Contact
                      </Badge>
                      <span className="max-w-[14rem] truncate font-semibold text-[#ECE7DF] sm:max-w-xs">
                        {r.contact_name}
                      </span>
                      {r.contact_email && (
                        <span className="max-w-[12rem] truncate text-xs text-[#AEA79A]">{r.contact_email}</span>
                      )}
                      <span className="text-xs text-[#8E877A]">·</span>
                      <span className="max-w-[12rem] truncate text-xs text-[#B9B2A6]">{r.company_name || "Company"}</span>
                      <span className="text-xs text-[#8E877A]">{timeAgo(d.created_at)}</span>
                    </div>
                    {d.label && <p className="mt-1 text-xs text-[#AEA79A]">{d.label}</p>}
                    {d.subject && <p className="mt-1 text-sm font-medium text-[#ECE7DF]">{d.subject}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="text-xs font-medium text-[#CEE4D4] hover:underline"
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      {open ? "Hide body" : "Show body"}
                    </button>
                    <Link
                      href={`/crm/contacts/${encodeURIComponent(r.contact_id)}`}
                      className="text-xs font-medium text-[#B9B2A6] hover:underline"
                    >
                      Open contact
                    </Link>
                    {r.pipeline_id && (
                      <Link
                        href={`/crm?open=${encodeURIComponent(r.pipeline_id)}`}
                        className="text-xs font-medium text-[#B9B2A6] hover:underline"
                      >
                        Pipeline card
                      </Link>
                    )}
                  </div>
                </div>
                <div className="bg-[#121713] px-4 py-2 text-sm text-[#CFC8BC]">
                  {open ? (
                    <pre className="whitespace-pre-wrap font-sans text-sm text-[#ECE7DF]">{d.body}</pre>
                  ) : (
                    <p className="italic">{previewText(d.body)}</p>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
