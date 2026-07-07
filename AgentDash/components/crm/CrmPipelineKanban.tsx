"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatPanel, type ChatPanelHandle, type ChatProject, type Message } from "@/components/chat/ChatPanel";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/app/providers";
import { cn } from "@/lib/utils";
import { Copy, Linkedin, Mail, Trash2, X } from "lucide-react";
import {
  buildFilterOptionsFromCards,
  comparePipelineCards,
  filterPipelineCards,
  FILTER_UNASSIGNED_ATHLETE,
  FILTER_UNCATEGORIZED,
  GENERAL_ATHLETE_ID,
  GENERAL_ATHLETE_NAME,
  type PipelineSortKey,
} from "@/lib/crm/pipeline-card-filter-sort";
import { postAiChat, type PostAiChatResult } from "@/lib/ai/chat-fetch";
import type { InteractionResponsePayload } from "@/lib/ai/user-question";
import type { ChatSseEvent } from "@/lib/ai/chat-sse";
import { normalizePipelineContacts, type PipelineContactSlot } from "@/lib/crm/pipeline-contacts";
import { CompanyContactsTable } from "@/components/crm/CompanyContactsTable";
import { PartnershipNotesDisplay } from "@/components/crm/PartnershipNotesDisplay";
import { CompanyCategorySelect } from "@/components/crm/CompanyCategorySelect";
import { CrmBrandIdeaQuickAdd } from "@/components/crm/CrmBrandIdeaQuickAdd";
import { safeHttpUrl } from "@/lib/security/url";
import { normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import {
  formatNoPartnershipsMessage,
  formatPartnershipResearchClientError,
} from "@/lib/ai/partnership-research";
import { STAGES, STAGE_LABEL, type PipelineStage } from "@/lib/crm/pipeline-stages";

export type { PipelineStage } from "@/lib/crm/pipeline-stages";
export { STAGE_LABEL } from "@/lib/crm/pipeline-stages";

/** Saved email drafts on a pipeline card (legacy entries may omit subject / athlete_id). */
export type PipelineDraftMessage = {
  label?: string;
  subject?: string;
  body: string;
  created_at: string;
  athlete_id?: string | null;
  sent_at?: string | null;
};

export type PipelineCard = {
  id: string;
  company_id: string;
  company_name: string;
  created_by_user_id?: string;
  pipeline_stage: PipelineStage;
  outreach_at: string | null;
  responded_at: string | null;
  idea_notes: string | null;
  company_description: string | null;
  personal_notes: string | null;
  past_partnerships: string | null;
  instagram_handle: string | null;
  website_url: string | null;
  support_email_v2: string | null;
  /** Three slots: name, role, email, linkedin (see normalizePipelineContacts). */
  pipeline_contacts?: unknown;
  potential_athletes: { athlete_id: string; name: string; sport?: string | null }[] | null;
  todos: { id: string; text: string; done: boolean }[] | null;
  closed_value: number | null;
  closed_athlete_id: string | null;
  closed_media_url: string | null;
  draft_messages: PipelineDraftMessage[] | null;
  archived?: boolean | null;
  updated_at?: string;
  /** From `companies` join */
  product_category?: string | null;
  managed_by_agency?: boolean;
  agency_name?: string | null;
  hq_phone?: string | null;
  /** People linked from CRM contacts (`source_contact_id` = crm_contacts.contact_id) */
  relevant_people?: Array<{
    name?: string | null;
    email?: string | null;
    linkedin_url?: string | null;
    source_contact_id?: string | null;
  }> | null;
};

const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  target: "research",
  research: "drafting",
  drafting: "outreach",
  outreach: "in_progress",
};

export function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

/** Value for `<input type="datetime-local" />` from a stored ISO timestamp. */
function outreachToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO string for API, or null if cleared / invalid. */
function outreachFromDatetimeLocalValue(local: string): string | null {
  const t = local.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function outreachTimestampsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if ((a == null || a === "") && (b == null || b === "")) return true;
  if (a == null || a === "" || b == null || b === "") return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

function defaultTabForStage(stage: PipelineStage): "overview" | "research" | "drafting" | "activity" | "deal" {
  switch (stage) {
    case "research":
      return "research";
    case "drafting":
      return "drafting";
    case "outreach":
    case "bounced":
    case "follow_up":
    case "ghost":
    case "in_progress":
      return "activity";
    case "closed":
      return "deal";
    default:
      return "overview";
  }
}

function stageBadgeClass(stage: PipelineStage): string {
  switch (stage) {
    case "target":
      return "bg-[#202723] text-[#D7D0C4] border-white/10";
    case "research":
      return "bg-[#1A2536] text-[#A5C0F2] border-[#3A5684]/40";
    case "drafting":
      return "bg-[#1E2243] text-[#B5B0F0] border-[#493DC7]/40";
    case "outreach":
      return "bg-[#281E3D] text-[#C5B0F0] border-[#6E4DC6]/40";
    case "bounced":
      return "bg-[#3A2418] text-[#F0B88A] border-[#C46A2E]/50";
    case "follow_up":
      return "bg-[#322712] text-[#E7C586] border-[#A67F1D]/40";
    case "ghost":
      return "bg-[#3A1E1E] text-[#E8A3A3] border-[#7C3737]/40";
    case "in_progress":
      return "bg-[#142A1E] text-[#A7E0B6] border-[#2E7040]/50";
    case "closed":
      return "bg-[#153723] text-[#9EDBAE] border-[#2E7040]/60";
    default:
      return "bg-[#202723] text-[#D7D0C4] border-white/10";
  }
}

function SavedFlash({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-xs text-green-500 transition-opacity">Saved ✓</span>;
}

const CRM_COMPANY_PANEL_WIDTH_KEY = "teamintel:crmCompanyPanelWidth";
const CRM_COMPANY_PANEL_DEFAULT = 520;
const CRM_COMPANY_PANEL_MIN = 360;
const CRM_COMPANY_PANEL_MAX_CAP = 1400;

function clampCompanyPanelWidth(px: number): number {
  if (typeof window === "undefined") return px;
  const maxFromViewport = Math.floor(window.innerWidth * 0.95);
  const max = Math.min(CRM_COMPANY_PANEL_MAX_CAP, maxFromViewport);
  return Math.max(CRM_COMPANY_PANEL_MIN, Math.min(max, Math.round(px)));
}

function readStoredCompanyPanelWidth(): number | null {
  try {
    const raw = localStorage.getItem(CRM_COMPANY_PANEL_WIDTH_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    return clampCompanyPanelWidth(n);
  } catch {
    return null;
  }
}

const CRM_DRAFTING_CHAT_HEIGHT_KEY = "teamintel:crmDraftingChatHeightPx";
const CRM_DRAFTING_CHAT_HEIGHT_DEFAULT = 420;
const CRM_DRAFTING_CHAT_HEIGHT_MIN = 260;
const CRM_DRAFTING_CHAT_HEIGHT_MAX_CAP = 900;
const CRM_DRAFTING_CHAT_RESIZE_BAR_PX = 10;

function clampDraftingChatHeight(px: number): number {
  if (typeof window === "undefined") return px;
  const maxFromViewport = Math.floor(window.innerHeight * 0.88);
  const max = Math.min(CRM_DRAFTING_CHAT_HEIGHT_MAX_CAP, maxFromViewport);
  return Math.max(CRM_DRAFTING_CHAT_HEIGHT_MIN, Math.min(max, Math.round(px)));
}

function readStoredDraftingChatHeight(): number | null {
  try {
    const raw = localStorage.getItem(CRM_DRAFTING_CHAT_HEIGHT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return null;
    return clampDraftingChatHeight(n);
  } catch {
    return null;
  }
}

async function patchCard(id: string, body: Record<string, unknown>): Promise<PipelineCard> {
  const res = await fetch(`/api/crm/pipeline/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Update failed");
  return data.card as PipelineCard;
}

export function CrmPipelineKanban({ initialOpenPipelineId = null }: { initialOpenPipelineId?: string | null } = {}) {
  const { profile } = useAuth();
  const role = (profile?.role ?? "agent") as "admin" | "sales" | "agent";

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [targetAddOpen, setTargetAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [pendingOutreach, setPendingOutreach] = useState<{ id: string; stage: PipelineStage } | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);
  const [filterSport, setFilterSport] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterAthleteId, setFilterAthleteId] = useState("");
  const [sortKey, setSortKey] = useState<PipelineSortKey>("updated");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [pendingOutreachBulk, setPendingOutreachBulk] = useState<string[] | null>(null);

  const openCard = useMemo(() => cards.find((c) => c.id === openId) ?? null, [cards, openId]);
  const selectedCount = selectedIds.size;

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/pipeline", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Failed to load pipeline");
      let list: PipelineCard[] = Array.isArray(data.cards) ? data.cards : [];

      const patchFns: Promise<unknown>[] = [];
      for (const card of list) {
        if (card.pipeline_stage !== "outreach" || !card.outreach_at || card.responded_at) continue;
        const now = Date.now();
        const outreachMs = new Date(card.outreach_at).getTime();
        const daysSince = (now - outreachMs) / (1000 * 60 * 60 * 24);
        if (daysSince >= 28) {
          patchFns.push(
            fetch(`/api/crm/pipeline/${card.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ pipeline_stage: "ghost" }),
            })
          );
        } else if (daysSince >= 14) {
          patchFns.push(
            fetch(`/api/crm/pipeline/${card.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ pipeline_stage: "follow_up" }),
            })
          );
        }
      }

      if (patchFns.length) {
        await Promise.all(patchFns);
        const res2 = await fetch("/api/crm/pipeline", { credentials: "include" });
        const data2 = await res2.json().catch(() => ({}));
        if (res2.ok && Array.isArray(data2.cards)) list = data2.cards;
      }

      setCards(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!initialOpenPipelineId || loading) return;
    if (cards.some((c) => c.id === initialOpenPipelineId)) {
      setOpenId(initialOpenPipelineId);
    }
  }, [loading, cards, initialOpenPipelineId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(t instanceof Element)) return;
      if (!t.closest?.("[data-crm-card-menu]")) setMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filterOptions = useMemo(() => buildFilterOptionsFromCards(cards), [cards]);

  const filteredCards = useMemo(
    () => filterPipelineCards(cards, { filterSport, filterCategory, filterAthleteId }),
    [cards, filterSport, filterCategory, filterAthleteId]
  );

  const byStage = useMemo(() => {
    const m = new Map<PipelineStage, PipelineCard[]>();
    for (const s of STAGES) m.set(s.id, []);
    for (const c of filteredCards) {
      const list = m.get(c.pipeline_stage);
      if (list) list.push(c);
      else m.set(c.pipeline_stage, [c]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => comparePipelineCards(a, b, sortKey));
    }
    return m;
  }, [filteredCards, sortKey]);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleCardSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredCards.map((c) => c.id)));
  };

  const dragPayloadForCard = (cardId: string): string => {
    if (selectionMode && selectedIds.has(cardId) && selectedIds.size > 1) {
      return [...selectedIds].join(",");
    }
    return cardId;
  };

  const idsFromDragPayload = (payload: string): string[] => {
    const ids = payload.split(",").map((s) => s.trim()).filter(Boolean);
    return ids.length > 0 ? ids : [];
  };

  const applyBulkStageUpdates = (updates: PipelineCard[]) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((c) => [c.id, c]));
    setCards((c) => c.map((x) => (byId.has(x.id) ? byId.get(x.id)! : x)));
  };

  const bulkMoveToStage = async (ids: string[], newStage: PipelineStage) => {
    const unique = [...new Set(ids)];
    const toMove = unique
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is PipelineCard => !!c && c.pipeline_stage !== newStage);
    if (toMove.length === 0) return;

    if (newStage === "outreach") {
      setPendingOutreachBulk(toMove.map((c) => c.id));
      return;
    }

    const prev = cards;
    const idSet = new Set(toMove.map((c) => c.id));
    setBulkMoving(true);
    setCards((c) => c.map((x) => (idSet.has(x.id) ? { ...x, pipeline_stage: newStage } : x)));
    try {
      const results = await Promise.allSettled(
        toMove.map((c) => patchCard(c.id, { pipeline_stage: newStage }))
      );
      const ok: PipelineCard[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") ok.push(r.value);
      }
      applyBulkStageUpdates(ok);
      if (ok.length < toMove.length) {
        setCards(prev);
        alert(`Moved ${ok.length} of ${toMove.length} companies. Some updates failed.`);
      } else {
        setSelectedIds(new Set());
      }
    } catch {
      setCards(prev);
      alert("Bulk move failed. Please try again.");
    } finally {
      setBulkMoving(false);
    }
  };

  const moveToStage = async (card: PipelineCard, newStage: PipelineStage, optimistic: boolean) => {
    if (selectionMode && selectedIds.has(card.id) && selectedIds.size > 1) {
      void bulkMoveToStage([...selectedIds], newStage);
      return;
    }
    if (newStage === "outreach") {
      setPendingOutreach({ id: card.id, stage: newStage });
      return;
    }
    const prev = cards;
    if (optimistic) {
      setCards((c) => c.map((x) => (x.id === card.id ? { ...x, pipeline_stage: newStage } : x)));
    }
    try {
      const updated = await patchCard(card.id, { pipeline_stage: newStage });
      setCards((c) => c.map((x) => (x.id === updated.id ? { ...updated } : x)));
    } catch {
      if (optimistic) setCards(prev);
    }
  };

  const confirmOutreach = async () => {
    const bulkIds = pendingOutreachBulk;
    const single = pendingOutreach;
    setPendingOutreach(null);
    setPendingOutreachBulk(null);

    const ids = bulkIds?.length ? bulkIds : single ? [single.id] : [];
    const toMove = ids
      .map((id) => cards.find((c) => c.id === id))
      .filter((c): c is PipelineCard => !!c);
    if (toMove.length === 0) return;

    const prev = cards;
    const idSet = new Set(toMove.map((c) => c.id));
    setBulkMoving(true);
    setCards((c) => c.map((x) => (idSet.has(x.id) ? { ...x, pipeline_stage: "outreach" } : x)));
    try {
      const results = await Promise.allSettled(
        toMove.map((c) =>
          patchCard(c.id, {
            pipeline_stage: "outreach",
          })
        )
      );
      const ok: PipelineCard[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") ok.push(r.value);
      }
      applyBulkStageUpdates(ok);
      if (ok.length < toMove.length) {
        setCards(prev);
        alert(`Marked ${ok.length} of ${toMove.length} as outreach. Some updates failed.`);
      } else {
        setSelectedIds(new Set());
      }
    } catch {
      setCards(prev);
      alert("Failed to mark outreach. Please try again.");
    } finally {
      setBulkMoving(false);
    }
  };

  const addCompany = async () => {
    const name = addName.trim();
    if (!name) return;
    const res = await fetch("/api/crm/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: name }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data?.error ?? "Failed to add");
      return;
    }
    const card = data.card as PipelineCard;
    setCards((c) => [card, ...c.filter((x) => x.id !== card.id)]);
    setAddName("");
    setTargetAddOpen(false);
  };

  const deleteCard = async (id: string) => {
    if (!confirm("Remove this company from your pipeline?")) return;
    const res = await fetch(`/api/crm/pipeline/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) return;
    setCards((c) => c.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
  };

  function handleDropOnStage(e: React.DragEvent, targetStage: PipelineStage) {
    setDragOverStage(null);
    const payload = e.dataTransfer.getData("text/plain");
    const ids = idsFromDragPayload(payload);
    if (ids.length === 0) return;
    if (ids.length > 1) {
      void bulkMoveToStage(ids, targetStage);
      return;
    }
    const dragged = cards.find((c) => c.id === ids[0]);
    if (!dragged || dragged.pipeline_stage === targetStage) return;
    void moveToStage(dragged, targetStage, true);
  }

  if (loading) {
    return (
      <div className="p-8 text-sm text-[#B9B2A6]">Loading pipeline…</div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col bg-[#0F1311]">
      {(pendingOutreach || pendingOutreachBulk) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg border border-white/10 bg-[#151A17] p-4 shadow-xl">
            <p className="text-sm text-[#ECE7DF]">
              Mark {pendingOutreachBulk?.length ?? 1}{" "}
              {(pendingOutreachBulk?.length ?? 1) === 1 ? "company" : "companies"} as Outreach? Today&apos;s date will
              be recorded as the outreach date for auto-follow-up tracking.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingOutreach(null);
                  setPendingOutreachBulk(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void confirmOutreach()}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 space-y-3 border-b border-white/10 bg-[#0F1311] px-4 py-3">
        <div className="space-y-3 rounded-lg border border-white/10 bg-[#151A17] p-4 shadow-sm">
          <h2 className="text-sm font-medium text-[#F4F1EB]">Quick Add Brand Idea</h2>
          <CrmBrandIdeaQuickAdd onSuccess={() => void bootstrap()} />
        </div>
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
          aria-label="Sort cards within columns"
          className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as PipelineSortKey)}
        >
          <option value="updated">Last updated</option>
          <option value="company">Company A–Z</option>
          <option value="sport">Sport</option>
          <option value="category">Product category</option>
          <option value="athlete">Potential athlete</option>
        </select>
        <span className="hidden text-white/20 sm:inline">|</span>
        <Button
          type="button"
          variant={selectionMode ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
        >
          {selectionMode ? "Done selecting" : "Select"}
        </Button>
      </div>

      {selectionMode && selectedCount > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-[#2E7040]/40 bg-[#1A2A20] px-4 py-2 text-sm">
          <span className="font-medium text-[#A7E0B6]">
            {selectedCount} selected{bulkMoving ? " · moving…" : ""}
          </span>
          <select
            aria-label="Move selected companies to stage"
            className="rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
            defaultValue=""
            disabled={bulkMoving}
            onChange={(e) => {
              const stage = e.target.value as PipelineStage;
              e.target.value = "";
              if (!stage) return;
              void bulkMoveToStage([...selectedIds], stage);
            }}
          >
            <option value="">Move to…</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
            disabled={bulkMoving}
            onClick={selectAllVisible}
          >
            Select all visible ({filteredCards.length})
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
            disabled={bulkMoving}
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-[#101513]">
        <div className="flex h-full min-w-max gap-3 p-4">
          {STAGES.map((col) => (
            <div
              key={col.id}
              className={cn(
                "flex w-64 min-w-64 max-h-full flex-col rounded-lg border border-white/10 bg-[#171D1A] transition-shadow",
                col.columnClass,
                dragOverStage === col.id && draggingCardId && "ring-2 ring-[#2E7040]/80 ring-offset-2 ring-offset-[#101513] bg-[#1D2D22]"
              )}
            >
              <div className="shrink-0 flex items-center justify-between border-b border-white/10 px-3 py-2">
                <span className="text-xs font-semibold tracking-wide text-[#CFC8BC] uppercase">{col.label}</span>
                <Badge variant="secondary" className="border border-white/10 bg-[#202723] px-1.5 py-0 text-[10px] text-[#D7D0C4]">
                  {(byStage.get(col.id) ?? []).length}
                </Badge>
              </div>
              <div
                className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2"
                onDragOver={(e) => {
                  if (!draggingCardId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverStage(col.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDropOnStage(e, col.id);
                }}
              >
                {(byStage.get(col.id) ?? []).map((card) => {
                  const isSelected = selectedIds.has(card.id);
                  const isDragging =
                    draggingCardId === card.id ||
                    (draggingCardId != null && selectionMode && isSelected && selectedIds.size > 1);
                  return (
                  <div
                    key={card.id}
                    className={cn(
                      "relative flex gap-2 rounded-lg border border-white/10 bg-[#222A26] p-3 text-left shadow-sm transition-shadow hover:bg-[#27322C] hover:shadow-md",
                      isDragging && "opacity-50",
                      selectionMode && isSelected && "ring-2 ring-[#2E7040]/80 border-[#2E7040]/50"
                    )}
                    onDragOver={(e) => {
                      if (!draggingCardId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverStage(col.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDropOnStage(e, col.id);
                    }}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${card.company_name}`}
                        className="mt-0.5 shrink-0 accent-[#2E7040]"
                        checked={isSelected}
                        onChange={() => toggleCardSelected(card.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span
                      draggable
                      aria-grabbed={draggingCardId === card.id}
                      title={selectionMode && isSelected && selectedCount > 1 ? "Drag to move all selected" : "Drag to move"}
                      className="shrink-0 cursor-grab select-none pt-0.5 leading-none text-[#9E978B] active:cursor-grabbing"
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData("text/plain", dragPayloadForCard(card.id));
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingCardId(card.id);
                      }}
                      onDragEnd={() => {
                        setDraggingCardId(null);
                        setDragOverStage(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      ⠿
                    </span>
                    <div
                      className={cn(
                        "flex-1 min-w-0 pr-6",
                        selectionMode ? "cursor-pointer" : "cursor-pointer"
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (selectionMode) toggleCardSelected(card.id);
                        else setOpenId(card.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (selectionMode) toggleCardSelected(card.id);
                          else setOpenId(card.id);
                        }
                      }}
                    >
                      <div className="truncate text-sm font-medium text-[#F4F1EB]">{card.company_name}</div>
                    </div>
                    <div className="absolute top-2 right-2" data-crm-card-menu onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rounded px-1 text-[#AFA89C] hover:bg-white/10 hover:text-[#F4F1EB]"
                        aria-label="Card menu"
                        onClick={() => setMenuOpenId((id) => (id === card.id ? null : card.id))}
                      >
                        ···
                      </button>
                      {menuOpenId === card.id && (
                        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-white/15 bg-[#161B18] py-1 text-sm shadow-lg">
                          <div className="px-2 py-1 text-[10px] uppercase text-[#8E877A]">Move to</div>
                          {STAGES.filter((s) => s.id !== card.pipeline_stage).map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="w-full px-3 py-1.5 text-left text-[#E6E0D5] hover:bg-white/5"
                              onClick={() => {
                                setMenuOpenId(null);
                                if (selectionMode && selectedIds.has(card.id) && selectedIds.size > 1) {
                                  void bulkMoveToStage([...selectedIds], s.id);
                                } else {
                                  void moveToStage(card, s.id, true);
                                }
                              }}
                            >
                              {s.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="w-full border-t border-white/10 px-3 py-1.5 text-left text-[#F1A2A2] hover:bg-[#3A1E1E]"
                            onClick={() => {
                              setMenuOpenId(null);
                              void deleteCard(card.id);
                            }}
                          >
                            Delete…
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
              {col.id === "target" && (
                <div className="shrink-0 border-t border-white/10 p-2">
                  {!targetAddOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
                      onClick={() => setTargetAddOpen(true)}
                    >
                      + Add company
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        className="flex-1 rounded border border-white/15 bg-[#101513] px-2 py-1.5 text-xs text-[#ECE7DF] placeholder:text-[#8E877A]"
                        placeholder="Company name"
                        value={addName}
                        onChange={(e) => setAddName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addCompany();
                        }}
                        autoFocus
                      />
                      <Button size="sm" className="text-xs shrink-0" onClick={() => void addCompany()}>
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {openCard && (
        <CompanySlideOver
          card={openCard}
          role={role}
          onClose={() => setOpenId(null)}
          onUpdate={(next) => setCards((c) => c.map((x) => (x.id === next.id ? next : x)))}
        />
      )}
    </div>
  );
}

function MailtoIcon({ email }: { email: string }) {
  const e = email.trim();
  if (!e) return null;
  return (
    <a
      href={`mailto:${encodeURIComponent(e)}`}
      className="inline-flex text-[#7BB6FF] hover:text-[#A7D1FF] ml-1"
      onClick={(ev) => ev.stopPropagation()}
    >
      <Mail className="h-3.5 w-3.5" />
    </a>
  );
}

function linkedinProfileHref(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

function LinkedinLinkIcon({ url }: { url: string }) {
  const href = linkedinProfileHref(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex text-[#0A66C2] hover:opacity-80 ml-1"
      onClick={(ev) => ev.stopPropagation()}
    >
      <Linkedin className="h-3.5 w-3.5" />
    </a>
  );
}

function CompanySlideOver({
  card,
  role,
  onClose,
  onUpdate,
}: {
  card: PipelineCard;
  role: "admin" | "sales" | "agent";
  onClose: () => void;
  onUpdate: (c: PipelineCard) => void;
}) {
  const [tab, setTab] = useState<"overview" | "research" | "drafting" | "activity" | "deal">(() =>
    defaultTabForStage(card.pipeline_stage)
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [companyEdit, setCompanyEdit] = useState(card.company_name);
  const [editingName, setEditingName] = useState(false);
  const [lastAssistantDraft, setLastAssistantDraft] = useState<string | null>(null);

  /** `null` until client measures viewport — keeps first paint aligned with previous `sm:w-[520px]` behavior. */
  const [panelViewport, setPanelViewport] = useState<"narrow" | "wide" | null>(null);
  const [panelWidthPx, setPanelWidthPx] = useState(CRM_COMPANY_PANEL_DEFAULT);
  const panelWidthRef = useRef(panelWidthPx);
  panelWidthRef.current = panelWidthPx;

  const resizeDragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [panelResizing, setPanelResizing] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setPanelViewport(mq.matches ? "narrow" : "wide");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const stored = readStoredCompanyPanelWidth();
    if (stored != null) setPanelWidthPx(stored);
  }, []);

  useEffect(() => {
    const onResize = () => setPanelWidthPx((w) => clampCompanyPanelWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setPanelWidthPx((w) => clampCompanyPanelWidth(w));
  }, [panelViewport]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = resizeDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const next = clampCompanyPanelWidth(drag.startWidth + (drag.startX - e.clientX));
      setPanelWidthPx(next);
    };
    const onUp = (e: PointerEvent) => {
      const drag = resizeDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      resizeDragRef.current = null;
      setPanelResizing(false);
      try {
        localStorage.setItem(CRM_COMPANY_PANEL_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        /* ignore quota / private mode */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onPanelResizePointerDown = (e: React.PointerEvent) => {
    if (panelViewport !== "wide") return;
    e.preventDefault();
    e.stopPropagation();
    setPanelResizing(true);
    resizeDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: panelWidthPx,
    };
  };

  useEffect(() => {
    setTab(defaultTabForStage(card.pipeline_stage));
  }, [card.pipeline_stage, card.id]);

  useEffect(() => {
    setCompanyEdit(card.company_name);
  }, [card.company_name, card.id]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, []);

  const savePatch = useCallback(
    async (body: Record<string, unknown>) => {
      const next = await patchCard(card.id, body);
      onUpdate(next);
      flashSaved();
    },
    [card.id, onUpdate, flashSaved]
  );

  const onSendChat = useCallback(
    async (
      messages: Message[],
      project: ChatProject,
      conversationId: string,
      options?: {
        signal?: AbortSignal;
        mode?: "default" | "deep_research" | "web_search";
        attachments?: File[];
        onStreamToken?: (text: string) => void;
        onStreamEvent?: (event: ChatSseEvent) => void;
        interactionResponse?: InteractionResponsePayload;
        flowMode?: "outbound" | "inbound" | "email" | "auto";
      }
    ): Promise<PostAiChatResult> => {
      const contacts: string[] = [];
      if (card.instagram_handle?.trim()) contacts.push(`Instagram: ${card.instagram_handle}`);
      if (card.website_url?.trim()) contacts.push(`Website: ${card.website_url}`);
      normalizePipelineContacts(card.pipeline_contacts).forEach((c, i) => {
        const bits: string[] = [];
        if (c.name.trim()) bits.push(`Name: ${c.name.trim()}`);
        if (c.role.trim()) bits.push(`Role: ${c.role.trim()}`);
        if (c.email.trim()) bits.push(`Email: ${c.email.trim()}`);
        if (c.linkedin.trim()) bits.push(`LinkedIn: ${c.linkedin.trim()}`);
        if (bits.length) contacts.push(`Contact ${i + 1}: ${bits.join("; ")}`);
      });

      const people = Array.isArray(card.relevant_people) ? card.relevant_people : [];
      const fromRelevantPeople = people
        .map((p) => ({
          name: String(p?.name ?? "").trim(),
          id: String(p?.source_contact_id ?? "").trim(),
          email: String(p?.email ?? "").trim(),
        }))
        .filter((p) => p.id.length > 0);

      const mergedById = new Map<string, { id: string; name: string; firstName: string; email: string }>();

      function greetingFirstName(fullName: string): string {
        const t = fullName.trim();
        if (!t) return "";
        const first = t.split(/\s+/)[0] ?? "";
        return first.replace(/,$/, "").trim();
      }

      for (const p of fromRelevantPeople) {
        const displayName = p.name || "Contact";
        mergedById.set(p.id, {
          id: p.id,
          name: displayName,
          firstName: greetingFirstName(displayName),
          email: p.email,
        });
      }

      const { data: dbContacts } = await supabase
        .from("crm_contacts")
        .select("contact_id, first_name, last_name, email")
        .eq("company_id", card.company_id);

      for (const row of dbContacts ?? []) {
        const id = String((row as { contact_id?: string }).contact_id ?? "").trim();
        if (!id) continue;
        const fn = String((row as { first_name?: string }).first_name ?? "").trim();
        const ln = String((row as { last_name?: string }).last_name ?? "").trim();
        const name = `${fn} ${ln}`.trim() || "Contact";
        const firstName = fn || greetingFirstName(name);
        const email = String((row as { email?: string | null }).email ?? "").trim();
        const existing = mergedById.get(id);
        if (!existing) {
          mergedById.set(id, { id, name, firstName, email });
        } else {
          mergedById.set(id, {
            id,
            name: existing.name === "Contact" && name !== "Contact" ? name : existing.name,
            firstName: firstName || existing.firstName || greetingFirstName(existing.name),
            email: existing.email || email,
          });
        }
      }

      const allCompanyContacts = [...mergedById.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

      const supportEmailOnCard = card.support_email_v2?.trim() ?? "";
      const instagramOnCard = card.instagram_handle?.trim() ?? "";

      const companyChannelsBlock =
        supportEmailOnCard || instagramOnCard
          ? [
              "Company channels on this pipeline card (used for an extra generic draft when pushing to contacts):",
              supportEmailOnCard ? `• Support / general email: ${supportEmailOnCard}` : "",
              instagramOnCard
                ? `• Instagram: ${instagramOnCard.startsWith("@") ? instagramOnCard : `@${instagramOnCard}`}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";

      const linkedCrmLines =
        allCompanyContacts.length > 0
          ? [
              `CRM contacts for "${card.company_name}" (${allCompanyContacts.length}) — authoritative list for this company. company_id=${card.company_id}`,
              `Phrases like "push to contacts", "push this to contacts", "save for each contact", "company contacts", "[brand] contacts", "all contacts": call pushEmailToCrm once per line below with that contact_id. Use company_name "${card.company_name}" on every call.`,
              `Each contact draft (pushEmailToCrm **with** that line's contact_id) must start with **Hey <FirstName>,** — use only the **first name for greeting** value on that contact's SESSION line (e.g. Hey Jane,). Do not use full name, do not use "Hi", do not leave [Recipient Name]; never use the company name as the addressee for person drafts. Then continue with the rest of the mandatory opening block (Hope you are well… I'm … at The·Team…).`,
              `You may reuse the same pitch for every contact; only personalize Hey <FirstName>, (and any direct first-name mentions in the body if needed).`,
              ...(supportEmailOnCard || instagramOnCard
                ? [
                    `After every per-contact save, call pushEmailToCrm once **without contact_id** (pipeline draft only): set label to \`Company — ${card.company_name}\`, and the body must start with Hi ${card.company_name}, (company/brand name for support inbox or Instagram/generic use — not a person's name).`,
                  ]
                : []),
              ...allCompanyContacts.map((p) => {
                const g = (p.firstName || "").trim() || greetingFirstName(p.name);
                return `- ${p.name} — first name for greeting: ${g || "(derive from name)"} — contact_id=${p.id}${p.email ? ` — ${p.email}` : ""}`;
              }),
            ].join("\n")
          : `No CRM contact records (crm_contacts) exist yet for company_id=${card.company_id}. Add contacts under CRM for this company, or ask the user to create them, before saving per-contact drafts. Pipeline-only saves omit contact_id.`;

      const potentialAthletes = (card.potential_athletes ?? [])
        .map((a) => a.name?.trim())
        .filter(Boolean);
      const potentialLines =
        potentialAthletes.length > 0
          ? `Potential athletes linked on this card: ${potentialAthletes.join("; ")}`
          : "";

      const extra_system_context = [
        `SESSION CONTEXT — CRM pipeline card for "${card.company_name}" (company_id=${card.company_id}).`,
        `If potential athletes are listed below, use them as the default athlete set for multi-athlete or group outreach unless the user specifies otherwise.`,
        card.product_category?.trim() ? `Product category: ${card.product_category.trim()}` : "",
        card.managed_by_agency && card.agency_name?.trim()
          ? `Brand is managed by agency: ${card.agency_name.trim()}`
          : "",
        card.idea_notes?.trim() ? `Ideas & notes (Overview): ${card.idea_notes}` : "",
        card.past_partnerships?.trim()
          ? `Past partnerships / sponsorship history: ${card.past_partnerships}`
          : "",
        card.company_description?.trim() ? `Company description: ${card.company_description}` : "",
        potentialLines,
        contacts.length ? `Contact points (Research): ${contacts.join("; ")}` : "",
        companyChannelsBlock,
        linkedCrmLines,
      ]
        .filter(Boolean)
        .join("\n");

      const payload = messages.map((m) => ({ role: m.role, content: m.content }));
      return postAiChat(
        {
          messages: payload,
          extra_system_context,
          pipeline_drafting: true,
          project_id: project.id,
          conversation_id: conversationId,
          project: {
            id: project.id,
            name: project.name,
            instructions: project.instructions,
            memory_notes: project.memoryNotes,
          },
          mode: options?.mode ?? "default",
          flow_mode: options?.flowMode ?? "email",
          ui_context: "crm_pipeline",
        },
        {
          signal: options?.signal,
          attachments: options?.attachments,
          onStreamToken: options?.onStreamToken,
          onStreamEvent: options?.onStreamEvent,
          interactionResponse: options?.interactionResponse,
        }
      );
    },
    [card]
  );

  const saveDraftFromChat = async () => {
    const body = lastAssistantDraft?.trim();
    if (!body) return;
    const prev = card.draft_messages ?? [];
    const entry: PipelineDraftMessage = {
      label: `Draft ${new Date().toLocaleString()}`,
      body,
      created_at: new Date().toISOString(),
    };
    await savePatch({ draft_messages: [...prev, entry] });
    setLastAssistantDraft(null);
  };

  const closed = card.pipeline_stage === "closed";
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "research", label: "Research" },
    { id: "drafting", label: "Drafting" },
    { id: "activity", label: "Activity" },
    ...(closed ? [{ id: "deal" as const, label: "Deal" }] : []),
  ];

  const panelWide = panelViewport === "wide";
  const usePersistedWidth = panelViewport !== null && panelWide;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close panel" onClick={onClose} />
      <div
        className={cn(
          "group/panel relative flex h-full flex-col border-l border-white/10 bg-[#151A17] shadow-2xl",
          panelViewport === null && "w-full sm:w-[520px]",
          panelViewport === "narrow" && "w-full",
          usePersistedWidth && "max-w-[95vw]"
        )}
        style={usePersistedWidth ? { width: panelWidthPx } : undefined}
      >
        {panelWide ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize company panel"
            tabIndex={0}
            className={cn(
              "absolute left-0 top-0 bottom-0 z-10 w-2 sm:w-1.5 -translate-x-1/2 cursor-col-resize touch-none",
              "hover:bg-[#2E7040]/25 active:bg-[#2E7040]/35",
              "flex justify-center items-stretch outline-none focus-visible:ring-2 focus-visible:ring-[#2E7040]/50 focus-visible:ring-inset",
              panelResizing && "bg-[#2E7040]/20"
            )}
            onPointerDown={onPanelResizePointerDown}
            onKeyDown={(e) => {
              if (panelViewport !== "wide") return;
              const step = e.shiftKey ? 40 : 16;
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                const next = clampCompanyPanelWidth(panelWidthPx + step);
                setPanelWidthPx(next);
                try {
                  localStorage.setItem(CRM_COMPANY_PANEL_WIDTH_KEY, String(next));
                } catch {
                  /* ignore */
                }
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                const next = clampCompanyPanelWidth(panelWidthPx - step);
                setPanelWidthPx(next);
                try {
                  localStorage.setItem(CRM_COMPANY_PANEL_WIDTH_KEY, String(next));
                } catch {
                  /* ignore */
                }
              }
            }}
          >
            <span
              className={cn(
                "w-px my-8 rounded-full bg-white/20 transition-opacity self-center min-h-[120px]",
                panelResizing ? "opacity-100" : "opacity-40 group-hover/panel:opacity-80"
              )}
              aria-hidden
            />
          </div>
        ) : null}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#B9B2A6]">Company</div>
          <button
            type="button"
            className="rounded p-1 text-[#B9B2A6] hover:bg-white/10 hover:text-[#F4F1EB]"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 flex gap-1 px-2 pt-2 overflow-x-auto border-b border-white/5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-[#2E7040] text-[#CEE4D4]"
                  : "border-transparent text-[#B9B2A6] hover:text-[#F4F1EB]"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {tab === "overview" && (
            <OverviewTab
              card={card}
              companyEdit={companyEdit}
              setCompanyEdit={setCompanyEdit}
              editingName={editingName}
              setEditingName={setEditingName}
              savePatch={savePatch}
              savedFlash={savedFlash}
            />
          )}
          {tab === "research" && <ResearchTab card={card} savePatch={savePatch} savedFlash={savedFlash} />}
          {tab === "drafting" && (
            <DraftingTab
              card={card}
              role={role}
              onSendChat={onSendChat}
              onAssistantReply={(content) => setLastAssistantDraft(content)}
              onEmailDraftChange={(content) => setLastAssistantDraft(content)}
              saveDraftFromChat={saveDraftFromChat}
              savePatch={savePatch}
              lastAssistantDraft={lastAssistantDraft}
              savedFlash={savedFlash}
            />
          )}
          {tab === "activity" && (
            <ActivityTab card={card} savePatch={savePatch} savedFlash={savedFlash} />
          )}
          {tab === "deal" && closed && (
            <DealTab card={card} savePatch={savePatch} savedFlash={savedFlash} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  card,
  companyEdit,
  setCompanyEdit,
  editingName,
  setEditingName,
  savePatch,
  savedFlash,
}: {
  card: PipelineCard;
  companyEdit: string;
  setCompanyEdit: (s: string) => void;
  editingName: boolean;
  setEditingName: (v: boolean) => void;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
  savedFlash: boolean;
}) {
  const next = NEXT_STAGE[card.pipeline_stage];

  return (
    <div className="space-y-4">
      <div>
        {editingName ? (
          <input
            className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-2xl font-semibold text-[#F4F1EB] placeholder:text-[#8E877A]"
            value={companyEdit}
            onChange={(e) => setCompanyEdit(e.target.value)}
            onBlur={() => {
              setEditingName(false);
              const t = companyEdit.trim();
              if (t && t !== card.company_name) void savePatch({ company_name: t });
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="text-left text-2xl font-semibold text-[#F4F1EB] hover:text-[#ECE7DF] hover:underline"
            onClick={() => setEditingName(true)}
          >
            {card.company_name}
          </button>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className={cn("text-xs px-2 py-0.5 rounded border", stageBadgeClass(card.pipeline_stage))}>
            {STAGE_LABEL[card.pipeline_stage]}
          </span>
          <SavedFlash show={savedFlash} />
        </div>
        <label className="block mt-3">
          <span className="text-xs font-medium text-[#B9B2A6]">Product category</span>
          <CompanyCategorySelect
            value={card.product_category}
            valueKey={`pc-${card.id}-${card.updated_at}`}
            onChange={(nextValue) => {
              const prev = (card.product_category ?? "").trim();
              const next = (nextValue ?? "").trim();
              if (next !== prev) void savePatch({ product_category: next || null });
            }}
          />
        </label>
        <label className="block mt-3">
          <span className="text-xs font-medium text-[#B9B2A6]">Outreach date</span>
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
            defaultValue={outreachToDatetimeLocalValue(card.outreach_at)}
            key={`outreach-dt-${card.id}-${card.updated_at}`}
            onBlur={(e) => {
              const next = outreachFromDatetimeLocalValue(e.target.value);
              if (!outreachTimestampsEqual(next, card.outreach_at)) {
                void savePatch({ outreach_at: next });
              }
            }}
          />
          {card.outreach_at && (
            <p className="text-xs text-[#8E877A] mt-1">Relative: {timeAgo(card.outreach_at)}</p>
          )}
          {!card.outreach_at && (
            <p className="text-xs text-[#8E877A] mt-1">Leave empty until outreach is recorded, or set manually.</p>
          )}
        </label>
        {card.responded_at && (
          <p className="text-sm text-[#B9B2A6]">Responded {new Date(card.responded_at).toLocaleDateString()}</p>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-[#B9B2A6]">Ideas & Notes</span>
        <textarea
          className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] min-h-[100px]"
          placeholder="Add ideas, context, potential angles..."
          defaultValue={card.idea_notes ?? ""}
          key={`idea-${card.id}-${card.updated_at}`}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (card.idea_notes ?? "")) void savePatch({ idea_notes: v });
          }}
        />
      </label>

      <PotentialAthletesBlock card={card} savePatch={savePatch} />

      {next && (
        <Button
          className="w-full"
          variant="outline"
          onClick={() => void savePatch({ pipeline_stage: next })}
        >
          Move to {STAGE_LABEL[next]} →
        </Button>
      )}
    </div>
  );
}

function PotentialAthletesBlock({
  card,
  savePatch,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ athlete_id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim() || q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const pattern = `%${normalizeOrIlikeFragment(q)}%`;
      const { data } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(15);
      const rows = (data ?? []).map((a) => ({
        athlete_id: a.athlete_id,
        name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
      }));
      setResults(rows);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const list = card.potential_athletes ?? [];
  const hasGeneral = list.some((x) => x.athlete_id === GENERAL_ATHLETE_ID);

  const addAthlete = (a: { athlete_id: string; name: string }) => {
    if (list.some((x) => x.athlete_id === a.athlete_id)) return;
    void savePatch({ potential_athletes: [...list, a] });
    setQ("");
    setOpen(false);
  };

  const addGeneral = () => {
    if (hasGeneral) return;
    void savePatch({
      potential_athletes: [...list, { athlete_id: GENERAL_ATHLETE_ID, name: GENERAL_ATHLETE_NAME }],
    });
    setQ("");
    setOpen(false);
  };

  const removeAthlete = (athlete_id: string) => {
    void savePatch({ potential_athletes: list.filter((x) => x.athlete_id !== athlete_id) });
  };

  return (
    <div>
      <div className="text-xs font-medium text-[#B9B2A6] mb-1">Potential Athletes</div>
      <ul className="space-y-1 mb-2">
        {list.map((a) => (
          <li
            key={a.athlete_id}
            className="flex items-center justify-between rounded border border-white/10 bg-[#1A211D] px-2 py-1 text-sm text-[#ECE7DF]"
          >
            <span>{a.name}</span>
            <button
              type="button"
              className="text-xs text-[#F1A2A2] hover:text-[#F8C5C5]"
              onClick={() => removeAthlete(a.athlete_id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="relative">
        <button
          type="button"
          className="text-sm text-[#CEE4D4] hover:text-[#E8F6ED]"
          onClick={() => setOpen((o) => !o)}
        >
          + Add athlete
        </button>
        {open && (
          <div className="mt-2 space-y-2 rounded-md border border-white/10 bg-[#171D1A] p-2 shadow-sm">
            <button
              type="button"
              className="w-full rounded border border-dashed border-white/15 px-2 py-1 text-left text-sm text-[#CEE4D4] hover:bg-white/5 disabled:opacity-50"
              onClick={addGeneral}
              disabled={hasGeneral}
              title={
                hasGeneral
                  ? "This card is already tagged General"
                  : "Tag this card as a general (no specific athlete) outreach"
              }
            >
              + Assign as <span className="font-medium">General</span>
              {hasGeneral ? " (already added)" : ""}
            </button>
            <input
              className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="Search athletes…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {results.map((a) => (
                <button
                  key={a.athlete_id}
                  type="button"
                  className="w-full rounded px-2 py-1 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                  onClick={() => addAthlete(a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContactSlotsEditor({ card, savePatch }: { card: PipelineCard; savePatch: (b: Record<string, unknown>) => Promise<void> }) {
  const normalized = useMemo(
    () => normalizePipelineContacts(card.pipeline_contacts),
    [card.pipeline_contacts, card.updated_at, card.id]
  );
  const [slots, setSlots] = useState<PipelineContactSlot[]>(normalized);
  useEffect(() => {
    setSlots(normalized);
  }, [normalized]);

  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-lg border border-white/10 bg-[#171D1A] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">Contact {i + 1}</div>
          <label className="block">
            <span className="text-xs font-medium text-[#B9B2A6]">Name</span>
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="Full name"
              value={slots[i]?.name ?? ""}
              onChange={(e) =>
                setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)))
              }
              onBlur={(e) => {
                const v = e.target.value.trim();
                setSlots((prev) => {
                  const next = prev.map((s, j) => (j === i ? { ...s, name: v } : s));
                  if (next[i]!.name !== normalized[i]!.name) void savePatch({ pipeline_contacts: next });
                  return next;
                });
              }}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[#B9B2A6]">Role</span>
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="e.g. CMO, Head of Partnerships"
              value={slots[i]?.role ?? ""}
              onChange={(e) =>
                setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, role: e.target.value } : s)))
              }
              onBlur={(e) => {
                const v = e.target.value.trim();
                setSlots((prev) => {
                  const next = prev.map((s, j) => (j === i ? { ...s, role: v } : s));
                  if (next[i]!.role !== normalized[i]!.role) void savePatch({ pipeline_contacts: next });
                  return next;
                });
              }}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[#B9B2A6] flex items-center gap-1">
              Email
              {slots[i]?.email?.trim() ? <MailtoIcon email={slots[i]!.email} /> : null}
            </span>
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="name@company.com"
              value={slots[i]?.email ?? ""}
              onChange={(e) =>
                setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, email: e.target.value } : s)))
              }
              onBlur={(e) => {
                const v = e.target.value.trim();
                setSlots((prev) => {
                  const next = prev.map((s, j) => (j === i ? { ...s, email: v } : s));
                  if (next[i]!.email !== normalized[i]!.email) void savePatch({ pipeline_contacts: next });
                  return next;
                });
              }}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[#B9B2A6] flex items-center gap-1">
              LinkedIn
              {slots[i]?.linkedin?.trim() ? <LinkedinLinkIcon url={slots[i]!.linkedin} /> : null}
            </span>
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="https://linkedin.com/in/… or profile URL"
              value={slots[i]?.linkedin ?? ""}
              onChange={(e) =>
                setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, linkedin: e.target.value } : s)))
              }
              onBlur={(e) => {
                const v = e.target.value.trim();
                setSlots((prev) => {
                  const next = prev.map((s, j) => (j === i ? { ...s, linkedin: v } : s));
                  if (next[i]!.linkedin !== normalized[i]!.linkedin) void savePatch({ pipeline_contacts: next });
                  return next;
                });
              }}
            />
          </label>
        </div>
      ))}
    </div>
  );
}

function PastPartnershipsField({
  card,
  savePatch,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
}) {
  const [researching, setResearching] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [localValue, setLocalValue] = useState(card.past_partnerships ?? "");
  const [error, setError] = useState<string | null>(null);
  const [searchEntryPointHtml, setSearchEntryPointHtml] = useState<string | null>(null);
  const [webQueries, setWebQueries] = useState<string[]>([]);

  useEffect(() => {
    setLocalValue(card.past_partnerships ?? "");
    setEditingNotes(false);
  }, [card.past_partnerships, card.id, card.updated_at]);

  async function research() {
    setResearching(true);
    setError(null);
    setSearchEntryPointHtml(null);
    setWebQueries([]);
    try {
      const res = await fetch(`/api/crm/pipeline/${card.id}/research-partnerships`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(formatPartnershipResearchClientError(data));
      }
      if (data.found === false) {
        const sourceCount = Array.isArray(data.source_urls) ? data.source_urls.length : 0;
        const evidenceCount = typeof data.evidence_count === "number" ? data.evidence_count : sourceCount;
        setError(
          formatNoPartnershipsMessage({
            research_backend: String(data.research_backend ?? ""),
            source_url_count: sourceCount,
            evidence_count: evidenceCount,
          })
        );
        return;
      }
      const next = String(data?.past_partnerships ?? "").trim();
      if (next) {
        setLocalValue(next);
        await savePatch({ past_partnerships: next });
      }
      setSearchEntryPointHtml(typeof data?.search_entry_point_html === "string" ? data.search_entry_point_html : null);
      setWebQueries(
        Array.isArray(data?.web_search_queries)
          ? data.web_search_queries.map((q: unknown) => String(q ?? "").trim()).filter(Boolean)
          : []
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
    }
  }

  return (
    <label className="block">
      <span className="text-xs font-medium text-[#B9B2A6] flex items-center justify-between gap-2">
        <span>Past Partnerships</span>
        <button
          type="button"
          onClick={() => void research()}
          disabled={researching}
          className="rounded-md border border-[#2E7040]/60 bg-[#1D2D22] px-2 py-0.5 text-[11px] text-[#CEE4D4] hover:bg-[#27352B] disabled:opacity-50"
          title="Runs web search (last ~3 years) and Gemini; only cites URLs from search results"
        >
          {researching ? "Researching…" : "Research web (3 yrs)"}
        </button>
      </span>
      {editingNotes ? (
        <textarea
          className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] min-h-[80px]"
          placeholder="Note any known sponsorships or athlete partnerships…"
          value={localValue}
          autoFocus
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (card.past_partnerships ?? "")) void savePatch({ past_partnerships: v });
            setEditingNotes(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="mt-1 w-full rounded-md border border-white/10 bg-[#101513] p-2 text-left hover:bg-white/5 min-h-[80px]"
          onClick={() => setEditingNotes(true)}
          title="Click to edit"
        >
          {localValue.trim() ? (
            <PartnershipNotesDisplay text={localValue} />
          ) : (
            <span className="text-sm text-[#8E877A]">Note any known sponsorships or athlete partnerships…</span>
          )}
        </button>
      )}
      {searchEntryPointHtml ? (
        <details className="mt-2 rounded-md border border-white/10 bg-[#131915] p-2">
          <summary className="cursor-pointer text-[11px] text-[#B9B2A6]">Google Search suggestions disclosure</summary>
          {/* Required disclosure content returned by grounding metadata. */}
          <div
            className="prose prose-invert mt-2 max-w-none text-xs"
            dangerouslySetInnerHTML={{ __html: searchEntryPointHtml }}
          />
        </details>
      ) : null}
      {webQueries.length > 0 ? (
        <div className="mt-2 text-[11px] text-[#8E877A]">Search queries: {webQueries.join(" | ")}</div>
      ) : null}
      {error ? <span className="mt-1 block text-xs text-[#F1A2A2]">{error}</span> : null}
    </label>
  );
}

function ResearchTab({
  card,
  savePatch,
  savedFlash,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
  savedFlash: boolean;
}) {
  const field = (
    label: string,
    key:
      | "instagram_handle"
      | "website_url"
      | "support_email_v2"
      | "company_description"
      | "personal_notes"
      | "hq_phone",
    placeholder: string,
    multiline?: boolean
  ) => {
    const val = (card[key] as string | null) ?? "";
    const mail = key.endsWith("_email") || key === "support_email_v2";
    return (
      <label className="block" key={key}>
        <span className="text-xs font-medium text-[#B9B2A6] flex items-center gap-1">
          {label}
          {mail && val.trim() ? <MailtoIcon email={val} /> : null}
        </span>
        {multiline ? (
          <textarea
            className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] min-h-[80px]"
            placeholder={placeholder}
            defaultValue={val}
            key={`${card.id}-${key}-${card.updated_at}`}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== val) void savePatch({ [key]: v });
            }}
          />
        ) : (
          <input
            className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
            placeholder={placeholder}
            defaultValue={val}
            key={`${card.id}-${key}-${card.updated_at}`}
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== val) void savePatch({ [key]: v });
            }}
          />
        )}
      </label>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SavedFlash show={savedFlash} />
      </div>
      <PastPartnershipsField card={card} savePatch={savePatch} />
      {field("Website", "website_url", "https://...")}
      {field("Instagram", "instagram_handle", "@brand")}
      {field("HQ Number", "hq_phone", "+1 (555) 555-5555")}
      {field("Support Email", "support_email_v2", "")}
      <CompanyContactsTable companyId={card.company_id} companyName={card.company_name} />
      <CompanyDescriptionField card={card} savePatch={savePatch} />
      {field("Personal Notes", "personal_notes", "Your personal notes on this company…", true)}
      <AgencySection card={card} savePatch={savePatch} />
    </div>
  );
}

function CompanyDescriptionField({
  card,
  savePatch,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
}) {
  const [generating, setGenerating] = useState(false);
  const [localValue, setLocalValue] = useState(card.company_description ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalValue(card.company_description ?? "");
  }, [card.company_description, card.id]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/pipeline/${card.id}/generate-description`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate description");
      }
      const desc = String(data?.company_description ?? "").trim();
      if (desc) {
        setLocalValue(desc);
        await savePatch({ company_description: desc });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate description");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <label className="block">
      <span className="text-xs font-medium text-[#B9B2A6] flex items-center justify-between gap-2">
        <span>Company Description</span>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="rounded-md border border-[#2E7040]/60 bg-[#1D2D22] px-2 py-0.5 text-[11px] text-[#CEE4D4] hover:bg-[#27352B] disabled:opacity-50"
          title="Generate with AI using web search"
        >
          {generating ? "Generating…" : "AI generate"}
        </button>
      </span>
      <textarea
        className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] min-h-[90px]"
        placeholder="What does this company do? (AI can fill this in from the web)"
        value={localValue}
        key={`cd-${card.id}-${card.updated_at}`}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (card.company_description ?? "")) void savePatch({ company_description: v });
        }}
      />
      {error ? <span className="mt-1 block text-xs text-[#F1A2A2]">{error}</span> : null}
    </label>
  );
}

function AgencySection({
  card,
  savePatch,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
}) {
  const managed = Boolean(card.managed_by_agency);

  return (
    <div className="pt-4 border-t border-white/10 space-y-3">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 rounded border-white/20 accent-[#2E7040]"
          checked={managed}
          onChange={(e) => {
            const v = e.target.checked;
            void savePatch(
              v ? { managed_by_agency: true } : { managed_by_agency: false, agency_name: null }
            );
          }}
        />
        <span className="text-sm leading-snug text-[#ECE7DF]">Company is managed by an agency</span>
      </label>
      {managed && (
        <label className="block">
          <span className="text-xs font-medium text-[#B9B2A6]">Agency name</span>
          <input
            className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
            placeholder="e.g. agency name"
            defaultValue={card.agency_name ?? ""}
            key={`agency-name-${card.id}-${card.updated_at}`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (card.agency_name ?? "")) void savePatch({ agency_name: v || null });
            }}
          />
        </label>
      )}
    </div>
  );
}

function DraftingTab({
  card,
  role,
  onSendChat,
  onAssistantReply,
  onEmailDraftChange,
  saveDraftFromChat,
  savePatch,
  lastAssistantDraft,
  savedFlash,
}: {
  card: PipelineCard;
  role: "admin" | "sales" | "agent";
  onSendChat: (
    messages: Message[],
    project: ChatProject,
    conversationId: string,
    options?: {
      signal?: AbortSignal;
      mode?: "default" | "deep_research" | "web_search";
      attachments?: File[];
      onStreamToken?: (text: string) => void;
      onStreamEvent?: (event: import("@/lib/ai/chat-sse").ChatSseEvent) => void;
      interactionResponse?: InteractionResponsePayload;
    }
  ) => Promise<PostAiChatResult>;
  onAssistantReply: (content: string) => void;
  onEmailDraftChange: (content: string) => void;
  saveDraftFromChat: () => Promise<void>;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
  lastAssistantDraft: string | null;
  savedFlash: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const drafts = card.draft_messages ?? [];
  const draftingChatRef = useRef<ChatPanelHandle>(null);
  const [athleteNamesById, setAthleteNamesById] = useState<Record<string, string>>({});

  const companyLabel = card.company_name.trim() || "this company";
  const linkedAthleteNames = useMemo(
    () =>
      (card.potential_athletes ?? [])
        .map((a) => a.name?.trim())
        .filter((n): n is string => Boolean(n)),
    [card.potential_athletes]
  );

  const individualEmailPrompt =
    linkedAthleteNames.length >= 1
      ? `Write an email for ${linkedAthleteNames[0]} to ${companyLabel}.`
      : `Write an individual outreach email for one athlete to ${companyLabel}.`;

  const multiAthleteEmailPrompt =
    linkedAthleteNames.length >= 2
      ? `Write individual outreach emails for multiple athletes to ${companyLabel}. The athletes are: ${linkedAthleteNames.join(", ")}.`
      : `Write individual outreach emails for multiple athletes to ${companyLabel}.`;

  useEffect(() => {
    const list = card.draft_messages ?? [];
    const ids = [...new Set(list.map((d) => d.athlete_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) {
      setAthleteNamesById({});
      return;
    }
    void supabase
      .from("athletes")
      .select("athlete_id, first_name, last_name")
      .in("athlete_id", ids)
      .then(({ data }) => {
        const next: Record<string, string> = {};
        for (const a of data ?? []) {
          const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.athlete_id;
          next[a.athlete_id] = name;
        }
        setAthleteNamesById(next);
      });
  }, [card.draft_messages]);

  const [draftingChatHeightPx, setDraftingChatHeightPx] = useState(CRM_DRAFTING_CHAT_HEIGHT_DEFAULT);
  const draftingChatHeightRef = useRef(draftingChatHeightPx);
  draftingChatHeightRef.current = draftingChatHeightPx;
  const chatResizeDragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const [chatResizeActive, setChatResizeActive] = useState(false);

  useEffect(() => {
    const stored = readStoredDraftingChatHeight();
    if (stored != null) setDraftingChatHeightPx(stored);
  }, []);

  useEffect(() => {
    const onResize = () => setDraftingChatHeightPx((h) => clampDraftingChatHeight(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = chatResizeDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const next = clampDraftingChatHeight(drag.startHeight + (e.clientY - drag.startY));
      setDraftingChatHeightPx(next);
    };
    const onUp = (e: PointerEvent) => {
      const drag = chatResizeDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      chatResizeDragRef.current = null;
      setChatResizeActive(false);
      try {
        localStorage.setItem(CRM_DRAFTING_CHAT_HEIGHT_KEY, String(draftingChatHeightRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onChatResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setChatResizeActive(true);
    chatResizeDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: draftingChatHeightPx,
    };
  };

  const draftingChatTotalHeight = draftingChatHeightPx + CRM_DRAFTING_CHAT_RESIZE_BAR_PX;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-medium text-[#B9B2A6] mb-2 flex justify-between">
          <span>Draft Messages</span>
          <SavedFlash show={savedFlash} />
        </div>
        <div className="space-y-2">
          {drafts.length === 0 && <p className="text-sm text-[#B9B2A6]">No saved drafts yet.</p>}
          {drafts.map((d, i) => {
            const header = (d.label?.trim() || d.subject?.trim() || "Draft") as string;
            const subject = d.subject?.trim() || "";
            const preview =
              d.body.length > 120 ? `${d.body.slice(0, 120).trim()}…` : d.body;
            const athleteLabel = d.athlete_id ? athleteNamesById[d.athlete_id] ?? "…" : null;
            return (
              <div
                key={`${d.created_at}-${i}`}
                className="rounded-md border border-white/10 bg-[#1A211D] p-2 text-sm text-[#ECE7DF]"
              >
                <button
                  type="button"
                  className="text-left w-full flex justify-between gap-2 items-start"
                  onClick={() => setExpanded((x) => (x === i ? null : i))}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#F4F1EB] truncate">{header}</div>
                    <div className="text-xs text-[#8E877A] mt-0.5">{timeAgo(d.created_at)}</div>
                    {athleteLabel && (
                      <Badge variant="secondary" className="mt-1 text-[10px] font-normal">
                        {athleteLabel}
                      </Badge>
                    )}
                    {d.sent_at && (
                      <p className="text-[10px] text-[#7FA88A] mt-0.5">
                        Sent {new Date(d.sent_at).toLocaleDateString()}
                      </p>
                    )}
                    <p className="text-[#B9B2A6] line-clamp-2 mt-1">{preview}</p>
                  </div>
                </button>
                {expanded === i && (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-2">
                    <div>
                      <div className="text-xs text-[#8E877A]">Subject</div>
                      <div className="text-sm text-[#F4F1EB]">{subject || "—"}</div>
                    </div>
                    <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-white/10 bg-[#101513] p-2 text-xs text-[#ECE7DF]">
                      {d.body}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const clip = subject ? `Subject: ${subject}\n\n${d.body}` : d.body;
                          void navigator.clipboard.writeText(clip);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1" />
                        Copy
                      </Button>
                      {!d.sent_at && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void savePatch({ mark_draft_sent: d.created_at })
                          }
                        >
                          Mark sent
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void draftingChatRef.current?.submitUserMessage(
                            `Here is a draft email for ${companyLabel}. Please help me refine it:\n\n${d.body}`
                          )
                        }
                      >
                        Refine in Mystery Machine
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#7C3737]/40 text-[#F1A2A2] hover:bg-[#3A1E1E] hover:text-[#F8C5C5]"
                        onClick={() => void savePatch({ draft_messages: drafts.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete draft
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-[#B9B2A6] mb-2">Generate with Mystery Machine</div>
        <div className="flex flex-row gap-2 mb-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={`Generate a general roster email for ${companyLabel}`}
            className="flex-1 min-w-0 h-auto py-2 px-1.5 whitespace-normal text-center text-[11px] sm:text-xs leading-tight"
            onClick={() =>
              void draftingChatRef.current?.submitUserMessage(`Write a general roster email for ${companyLabel}`)
            }
          >
            <span className="block">📋 General Roster</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Generate an individual athlete outreach email"
            className="flex-1 min-w-0 h-auto py-2 px-1.5 whitespace-normal text-center text-[11px] sm:text-xs leading-tight"
            onClick={() => void draftingChatRef.current?.submitUserMessage(individualEmailPrompt)}
          >
            <span className="block">📧 Individual Athlete</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 min-w-0 h-auto py-2 px-1.5 whitespace-normal text-center text-[11px] sm:text-xs leading-tight"
            title={
              linkedAthleteNames.length < 2
                ? "Generate emails for multiple athletes (Flow 6). Link two or more athletes on this card to name them automatically, or rely on session context."
                : "Generate individual emails for multiple athletes"
            }
            onClick={() => void draftingChatRef.current?.submitUserMessage(multiAthleteEmailPrompt)}
          >
            <span className="block">📧 Multi-athlete</span>
          </Button>
        </div>
        <div
          className="flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#101513] shadow-sm"
          style={{ height: draftingChatTotalHeight }}
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <ChatPanel
              ref={draftingChatRef}
              key={card.id}
              title="Mystery Machine"
              roleScope={role}
              onSend={onSendChat}
              layout="embedded"
              uiContext="crm_pipeline"
              contextCompanyName={card.company_name}
              embeddedDedicatedProjectName={`Pipeline draft ${card.id}`}
              placeholder="Draft outreach…"
              onAssistantReply={onAssistantReply}
              onEmailDraftChange={onEmailDraftChange}
            />
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize Mystery Machine height"
            tabIndex={0}
            className={cn(
              "shrink-0 border-t border-white/10 bg-[#141916] flex items-center justify-center cursor-ns-resize touch-none select-none",
              "hover:bg-[#2E7040]/15 active:bg-[#2E7040]/25 outline-none focus-visible:ring-2 focus-visible:ring-[#2E7040]/50 focus-visible:ring-inset",
              chatResizeActive && "bg-[#2E7040]/20"
            )}
            style={{ height: CRM_DRAFTING_CHAT_RESIZE_BAR_PX }}
            onPointerDown={onChatResizePointerDown}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 48 : 24;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = clampDraftingChatHeight(draftingChatHeightPx + step);
                setDraftingChatHeightPx(next);
                try {
                  localStorage.setItem(CRM_DRAFTING_CHAT_HEIGHT_KEY, String(next));
                } catch {
                  /* ignore */
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = clampDraftingChatHeight(draftingChatHeightPx - step);
                setDraftingChatHeightPx(next);
                try {
                  localStorage.setItem(CRM_DRAFTING_CHAT_HEIGHT_KEY, String(next));
                } catch {
                  /* ignore */
                }
              }
            }}
          >
            <span
              className={cn(
                "h-0.5 w-10 rounded-full transition-colors",
                chatResizeActive ? "bg-[#4F9E63]" : "bg-white/25"
              )}
              aria-hidden
            />
          </div>
        </div>
        {lastAssistantDraft && (
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void saveDraftFromChat()}>
              Save this draft
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTab({
  card,
  savePatch,
  savedFlash,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
  savedFlash: boolean;
}) {
  const [todoInput, setTodoInput] = useState("");
  const todos = useMemo(
    () =>
      (card.todos ?? []).map((t, i) => ({
        id: typeof t.id === "string" && t.id ? t.id : `todo-${i}-${t.text}`,
        text: t.text,
        done: !!t.done,
      })),
    [card.todos]
  );

  const setTodos = (next: { id: string; text: string; done: boolean }[]) => {
    void savePatch({ todos: next });
  };

  const timeline: { line: string; sub?: string }[] = [];
  if (card.outreach_at) {
    timeline.push({
      line: `Outreach recorded`,
      sub: `${new Date(card.outreach_at).toLocaleString()} · ${timeAgo(card.outreach_at)}`,
    });
  }
  if (card.pipeline_stage === "bounced") {
    timeline.push({
      line: "Email bounced",
      sub: "Invalid address or delivery failure — update contact and try a different email",
    });
  }
  if (card.pipeline_stage === "follow_up") {
    timeline.push({
      line: "In Follow-Up",
      sub: "Auto stage after 14 days without a response (still in outreach window)",
    });
  }
  if (card.pipeline_stage === "ghost") {
    timeline.push({
      line: "In Ghost",
      sub: "Auto stage after 28 days without a response",
    });
  }
  if (card.responded_at) {
    timeline.push({
      line: "Response recorded",
      sub: new Date(card.responded_at).toLocaleString(),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <SavedFlash show={savedFlash} />
      </div>
      <div>
        <div className="text-xs font-medium text-[#B9B2A6] mb-2">Timeline</div>
        <ul className="space-y-3 border-l-2 border-white/15 pl-3">
          {timeline.length === 0 && <li className="text-sm text-[#B9B2A6]">No activity yet.</li>}
          {timeline.map((t, i) => (
            <li key={i}>
              <div className="text-sm font-medium text-[#F4F1EB]">{t.line}</div>
              {t.sub && <div className="text-xs text-[#8E877A]">{t.sub}</div>}
            </li>
          ))}
        </ul>
      </div>

      {(card.pipeline_stage === "outreach" || card.pipeline_stage === "follow_up") && (
        <Button
          onClick={() =>
            void savePatch({
              pipeline_stage: "in_progress",
              responded_at: new Date().toISOString(),
            })
          }
        >
          Mark as Responded
        </Button>
      )}

      {card.pipeline_stage === "in_progress" && (
        <div>
          <div className="text-xs font-medium text-[#B9B2A6] mb-2">To-Do</div>
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-start gap-2 text-sm text-[#ECE7DF]">
                <input
                  type="checkbox"
                  className="mt-1 accent-[#2E7040]"
                  checked={todo.done}
                  onChange={() => {
                    const next = todos.map((x) => (x.id === todo.id ? { ...x, done: !x.done } : x));
                    setTodos(next);
                  }}
                />
                <span className={cn("flex-1", todo.done && "line-through text-[#8E877A]")}>{todo.text}</span>
                <button
                  type="button"
                  className="text-xs text-[#F1A2A2] hover:text-[#F8C5C5]"
                  onClick={() => setTodos(todos.filter((x) => x.id !== todo.id))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-2">
            <input
              className="flex-1 rounded border border-white/15 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="New to-do…"
              value={todoInput}
              onChange={(e) => setTodoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && todoInput.trim()) {
                  setTodos([...todos, { id: crypto.randomUUID(), text: todoInput.trim(), done: false }]);
                  setTodoInput("");
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!todoInput.trim()) return;
                setTodos([...todos, { id: crypto.randomUUID(), text: todoInput.trim(), done: false }]);
                setTodoInput("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      {card.pipeline_stage === "ghost" && (
        <Button
          variant="outline"
          onClick={() =>
            void savePatch({
              pipeline_stage: "target",
              outreach_at: null,
            })
          }
        >
          Re-engage
        </Button>
      )}

      {card.pipeline_stage === "bounced" && (
        <Button
          variant="outline"
          onClick={() =>
            void savePatch({
              pipeline_stage: "research",
            })
          }
        >
          Find new contact
        </Button>
      )}
    </div>
  );
}

function DealTab({
  card,
  savePatch,
  savedFlash,
}: {
  card: PipelineCard;
  savePatch: (b: Record<string, unknown>) => Promise<void>;
  savedFlash: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ athlete_id: string; name: string }[]>([]);
  const [athleteName, setAthleteName] = useState<string | null>(null);

  useEffect(() => {
    if (!card.closed_athlete_id) {
      setAthleteName(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("athletes")
        .select("first_name, last_name")
        .eq("athlete_id", card.closed_athlete_id)
        .maybeSingle();
      if (data) setAthleteName([data.first_name, data.last_name].filter(Boolean).join(" ").trim());
    })();
  }, [card.closed_athlete_id]);

  useEffect(() => {
    if (!q.trim() || q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const pattern = `%${normalizeOrIlikeFragment(q)}%`;
      const { data } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(15);
      const rows = (data ?? []).map((a) => ({
        athlete_id: a.athlete_id,
        name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
      }));
      setResults(rows);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const value = card.closed_value;
  const link = card.closed_media_url ?? "";
  const safeClosedMediaUrl = safeHttpUrl(link);
  const complete =
    value !== null &&
    value !== undefined &&
    !Number.isNaN(Number(value)) &&
    !!card.closed_athlete_id &&
    !!link.trim();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <SavedFlash show={savedFlash} />
      </div>
      <label className="block">
        <span className="text-xs font-medium text-[#B9B2A6]">Deal Value ($)</span>
        <input
          type="number"
          className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          defaultValue={value ?? ""}
          key={`cv-${card.id}-${card.updated_at}`}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const n = raw === "" ? null : Number(raw);
            if (n !== value && (n === null || !Number.isNaN(n))) void savePatch({ closed_value: n });
          }}
        />
      </label>

      <div>
        <span className="text-xs font-medium text-[#B9B2A6]">Athlete</span>
        <div className="mt-1 space-y-2">
          {card.closed_athlete_id && (
            <div className="text-sm text-[#ECE7DF]">{athleteName ?? card.closed_athlete_id}</div>
          )}
          <input
            className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
            placeholder="Search athlete…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-36 overflow-y-auto rounded border border-white/10 bg-[#171D1A]">
            {results.map((a) => (
              <button
                key={a.athlete_id}
                type="button"
                className="w-full px-2 py-1 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                onClick={() => {
                  void savePatch({ closed_athlete_id: a.athlete_id });
                  setAthleteName(a.name);
                  setQ("");
                  setResults([]);
                }}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-[#B9B2A6]">Media / Contract Link</span>
        <input
          className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] p-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          placeholder="https://…"
          defaultValue={link}
          key={`cm-${card.id}-${card.updated_at}`}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== link) void savePatch({ closed_media_url: v || null });
          }}
        />
      </label>

      {complete && (
        <div className="rounded-lg border border-[#2E7040]/50 bg-[#1D2D22] p-3 text-sm text-[#CEE4D4]">
          {athleteName ?? "Athlete"} — ${Number(value).toLocaleString()} —{" "}
          {safeClosedMediaUrl ? (
            <a href={safeClosedMediaUrl} className="break-all underline hover:text-[#E8F6ED]" target="_blank" rel="noreferrer">
              {link}
            </a>
          ) : (
            <span className="break-all text-[#D7D0C4]">{link}</span>
          )}
        </div>
      )}
    </div>
  );
}
