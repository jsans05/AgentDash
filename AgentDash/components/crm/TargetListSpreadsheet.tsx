"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, Maximize2, Minimize2 } from "lucide-react";
import { ContactEmailCell } from "@/components/crm/ContactEmailCell";
import { ContactPhoneCell } from "@/components/crm/ContactPhoneCell";
import { ApolloFindContactsInline } from "@/components/crm/ApolloFindContactsInline";
import { ApolloRefineSearchDialog } from "@/components/crm/ApolloRefineSearchDialog";
import { contactSearchOverridesToRequestBody } from "@/lib/apollo/contact-search-api-body";
import {
  loadApolloRevenueFilterPrefs,
  parseRevenueFilterBody,
  saveApolloRevenueFilterPrefs,
  type ApolloRevenueFilterPrefs,
} from "@/lib/apollo/prospecting-prefs";
import type { ApolloContactSearchOverrides } from "@/lib/apollo/search-defaults";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { PartnershipNotesDisplay } from "@/components/crm/PartnershipNotesDisplay";
import { AgencyActivityCell } from "@/components/crm/AgencyActivityCell";
import {
  getTargetListColumns,
  type TargetListVariant,
} from "@/lib/crm/target-list-column-config";
import { exportTargetListToExcel } from "@/lib/crm/target-list-export";
import { FirmographicsInvestigateCell } from "@/components/crm/FirmographicsInvestigateCell";
import { CompanyRecentNewsProvider } from "@/components/crm/CompanyRecentNewsPanel";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { TargetListAiPanel } from "@/components/crm/TargetListAiDock";
import { MasterTargetListAiPanel } from "@/components/crm/MasterTargetListAiDock";
import { TargetListCompanyContactActions } from "@/components/crm/TargetListCompanyContactActions";
import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import {
  readStoredTargetListPanelCollapsed,
  readStoredTargetListFocusMode,
  writeStoredTargetListFocusMode,
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";
import {
  buildTargetListSessionContext,
  type TargetListFocusedRow,
} from "@/lib/crm/target-list-session-context";
import { writeTargetListSessionContext } from "@/lib/crm/target-list-session-storage";
import { buildMasterTargetListSessionContext } from "@/lib/crm/master-target-list-session-context";
import { cn } from "@/lib/utils";
import { formatApolloPartnershipSearchSummary } from "@/lib/apollo/search-defaults";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY,
  TARGET_LIST_FIND_CONTACTS_DISMISS_KEY,
  TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY,
  TARGET_LIST_REMOVE_UNREVEALED_ALL_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";
import { batchDeleteCrmContacts } from "@/lib/crm/batch-delete-contacts";
import {
  collectUnrevealedDeletableContactIds,
  isBulkRemovableTargetListContact,
  isDeletableTargetListContact,
  mapApiContactToTargetList,
  mergeCompanyContactsIntoRows,
  patchContactInRows,
  removeContactFromRows,
  removeContactsFromRows,
} from "@/lib/crm/target-list-contacts";
import {
  formatNoPartnershipsMessage,
  formatPartnershipResearchClientError,
  partnershipResearchBulkDelayMs,
} from "@/lib/ai/partnership-research";
import { sleepMs } from "@/lib/ai/gemini-call";
import { safeHttpUrl } from "@/lib/security/url";
import {
  sortTargetListRows,
  type TargetListContact,
  type TargetListRow,
} from "@/lib/crm/athlete-target-list";
import type { MasterTargetListAthlete } from "@/lib/crm/master-target-list";
import { upsertContactOutreachDraft } from "@/lib/crm/target-list-outreach";

type SpreadsheetRow = TargetListRow & {
  assigned_athletes?: MasterTargetListAthlete[];
};

const UNCATEGORIZED_LABEL = "Uncategorized";

function formatMatchScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function parseMatchScoreInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    throw new Error("Enter a valid number");
  }
  return n;
}

type FlatRow = {
  key: string;
  rowIndex: number;
  contactIndex: number | null;
  showCategory: boolean;
  showCompany: boolean;
  hasContact: boolean;
  isPlaceholderContact: boolean;
};

function buildFlatRows(rows: SpreadsheetRow[]): FlatRow[] {
  const flat: FlatRow[] = [];
  let prevCategoryKey: string | null = null;
  let prevCompanyId: string | null = null;

  rows.forEach((r, rowIndex) => {
    const categoryKey = (r.category ?? UNCATEGORIZED_LABEL).toLowerCase();
    const contactIndexes: (number | null)[] = r.contacts.length > 0 ? r.contacts.map((_, i) => i) : [null];

    contactIndexes.forEach((ci, idx) => {
      const showCategory = categoryKey !== prevCategoryKey && idx === 0;
      const showCompany = r.company_id !== prevCompanyId;
      flat.push({
        key: `${r.pipeline_id}:${ci != null ? r.contacts[ci]?.contact_id : "empty"}:${idx}`,
        rowIndex,
        contactIndex: ci,
        showCategory,
        showCompany,
        hasContact: ci != null,
        isPlaceholderContact: ci == null,
      });
      prevCategoryKey = categoryKey;
      prevCompanyId = r.company_id;
    });
  });

  return flat;
}

/* -------------------------------------------------------------------------- */
/* Editable cell                                                              */
/* -------------------------------------------------------------------------- */

type EditableCellProps = {
  value: string | null | undefined;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  display?: (v: string) => React.ReactNode;
  className?: string;
  minHeightPx?: number;
};

function EditableCell({
  value,
  onSave,
  placeholder,
  multiline,
  disabled,
  display,
  className,
  minHeightPx = 28,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setLocal(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  async function commit() {
    const next = local.trim();
    const prev = (value ?? "").trim();
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const rendered = display ? display(value ?? "") : value ? <span className="text-[#ECE7DF]">{value}</span> : <span className="text-[#8E877A]">—</span>;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : "Click to edit"}
        className={`w-full rounded px-0.5 py-0.5 text-left hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-1 focus:ring-[#2E7040]/60 ${
          disabled ? "cursor-default hover:bg-transparent" : "cursor-text"
        } ${className ?? ""}`}
        style={{ minHeight: minHeightPx }}
      >
        {rendered}
      </button>
    );
  }

  const commonClass =
    "w-full rounded border border-[#2E7040]/50 bg-[#101513] px-1 py-0.5 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] focus:outline-none focus:ring-1 focus:ring-[#2E7040]";

  return (
    <div className="space-y-1">
      {multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          className={`${commonClass} resize-y`}
          rows={3}
          value={local}
          placeholder={placeholder}
          disabled={saving}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLocal(value ?? "");
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          className={commonClass}
          value={local}
          placeholder={placeholder}
          disabled={saving}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLocal(value ?? "");
              setEditing(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
          }}
        />
      )}
      {error ? <span className="text-[11px] text-[#F1A2A2]">{error}</span> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export type TargetListSpreadsheetProps = {
  mode: TargetListVariant;
  athleteId?: string;
  athleteName?: string;
  className?: string;
};

export function TargetListSpreadsheet({
  mode,
  athleteId,
  athleteName,
  className,
}: TargetListSpreadsheetProps) {
  const isMaster = mode === "master";
  const isAthlete = mode === "athlete";
  const columns = useMemo(() => getTargetListColumns(mode), [mode]);
  const loadUrl = isMaster
    ? "/api/master-target-list"
    : `/api/athletes/${athleteId}/target-list`;
  const pageTitle = isMaster
    ? "Master Target List"
    : athleteName
      ? `${athleteName} — Target List`
      : "Target List";

  const [rows, setRows] = useState<SpreadsheetRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [bulkPartnershipResearch, setBulkPartnershipResearch] = useState(false);
  const [bulkPartnershipIndex, setBulkPartnershipIndex] = useState(0);
  const [researchingPipelineId, setResearchingPipelineId] = useState<string | null>(null);
  const [partnershipResearchErrorByPipelineId, setPartnershipResearchErrorByPipelineId] = useState<
    Record<string, string>
  >({});
  const [bulkFindContacts, setBulkFindContacts] = useState(false);
  const [searchDisclosureHtml, setSearchDisclosureHtml] = useState<string | null>(null);
  const [searchDisclosureCompany, setSearchDisclosureCompany] = useState<string | null>(null);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [bulkFindConfirmOpen, setBulkFindConfirmOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{
    pipelineId: string;
    companyName: string;
    assignedAthletes?: MasterTargetListAthlete[];
    selectedAthleteIds: string[];
  } | null>(null);
  const [matchScoreAthletePick, setMatchScoreAthletePick] = useState<{
    rowIndex: number;
    pendingScore: number | null;
  } | null>(null);
  const [activeAthleteFilter, setActiveAthleteFilter] = useState<string>("all");
  const [removingPipelineId, setRemovingPipelineId] = useState<string | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [deletingContactsCompanyId, setDeletingContactsCompanyId] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{
    companyId: string;
    contactIds: string[];
    mode: "unrevealed" | "selected" | "duplicates";
  } | null>(null);
  const [bulkRemoveUnrevealed, setBulkRemoveUnrevealed] = useState(false);
  const [bulkRemoveUnrevealedConfirmOpen, setBulkRemoveUnrevealedConfirmOpen] = useState(false);
  const [apolloProspectingPrefs, setApolloProspectingPrefs] = useState<ApolloRevenueFilterPrefs>({});
  const [apolloSearchOverrides, setApolloSearchOverrides] = useState<ApolloContactSearchOverrides>({});
  const [refineSearchOpen, setRefineSearchOpen] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState(TARGET_LIST_CATEGORY_FILTER_ALL);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [focusedRow, setFocusedRow] = useState<TargetListFocusedRow | null>(null);
  const [flashedPipelineIds, setFlashedPipelineIds] = useState<Set<string>>(new Set());
  const [updateToast, setUpdateToast] = useState<string | null>(null);
  const [aiDockCollapsed, setAiDockCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [navOffsetPx, setNavOffsetPx] = useState(64);
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const flashAfterLoadRef = useRef<Set<string> | null>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

  const bulkActionsDisabled =
    bulkFindContacts ||
    bulkPartnershipResearch ||
    bulkRemoveUnrevealed ||
    researchingPipelineId != null ||
    loading ||
    !rows ||
    rows.length === 0;

  const unrevealedContactIds = useMemo(
    () => (rows ? collectUnrevealedDeletableContactIds(rows) : []),
    [rows]
  );

  const setFocusModePersisted = useCallback((next: boolean) => {
    setFocusMode(next);
    writeStoredTargetListFocusMode(next);
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("focus", "1");
      else url.searchParams.delete("focus");
      window.history.replaceState(null, "", url.toString());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setAiDockCollapsed(readStoredTargetListPanelCollapsed());
    const prefs = loadApolloRevenueFilterPrefs();
    setApolloProspectingPrefs(prefs);
    setApolloSearchOverrides(parseRevenueFilterBody(prefs));
    try {
      const urlFocus = new URLSearchParams(window.location.search).get("focus") === "1";
      setFocusMode(urlFocus || readStoredTargetListFocusMode());
    } catch {
      setFocusMode(readStoredTargetListFocusMode());
    }
  }, []);

  useEffect(() => {
    if (!focusMode) return;
    function measureNav() {
      const nav = document.querySelector("nav");
      setNavOffsetPx(nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 64);
    }
    measureNav();
    window.addEventListener("resize", measureNav);
    return () => window.removeEventListener("resize", measureNav);
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [focusMode]);

  useEffect(() => {
    if (!bulkActionsOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(e.target as Node)) {
        setBulkActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [bulkActionsOpen]);

  function updateApolloProspectingPrefs(prefs: ApolloRevenueFilterPrefs) {
    setApolloProspectingPrefs(prefs);
    saveApolloRevenueFilterPrefs(prefs);
    setApolloSearchOverrides(parseRevenueFilterBody(prefs));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(loadUrl, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load target list");
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load target list");
    } finally {
      setLoading(false);
    }
  }, [loadUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingPhoneContactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows ?? []) {
      for (const c of row.contacts) {
        if (c.apollo_phone_reveal_status === "pending") ids.add(c.contact_id);
      }
    }
    return ids;
  }, [rows]);

  useEffect(() => {
    if (pendingPhoneContactIds.size === 0) return;

    let cancelled = false;
    async function pollPendingPhones() {
      for (const contactId of pendingPhoneContactIds) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/crm/contacts/${contactId}`, { credentials: "include" });
          const data = await res.json();
          const c = data?.contact;
          if (!c || cancelled) continue;
          const status = c.apollo_phone_reveal_status;
          const normalizedStatus =
            status === "pending" || status === "revealed" ? status : null;
          if (c.phone || normalizedStatus !== "pending") {
            setRows((prev) =>
              prev
                ? patchContactInRows(prev, contactId, {
                    phone: c.phone != null ? String(c.phone) : null,
                    apollo_phone_reveal_status: normalizedStatus,
                  })
                : prev
            );
          }
        } catch {
          // ignore transient poll errors
        }
      }
    }

    void pollPendingPhones();
    const timer = setInterval(() => void pollPendingPhones(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingPhoneContactIds]);

  const categorySummary = useMemo(() => {
    if (!rows) return { sorted: [] as Array<[string, number]>, uncategorized: 0, total: 0 };
    const cats = new Map<string, number>();
    let uncategorized = 0;
    for (const r of rows) {
      if (isEffectivelyUncategorizedCompanyCategory(r.category)) uncategorized += 1;
      else {
        const c = String(r.category ?? "").trim();
        if (c) cats.set(c, (cats.get(c) ?? 0) + 1);
      }
    }
    return {
      sorted: [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" })),
      uncategorized,
      total: rows.length,
    };
  }, [rows]);

  const masterRosterAthletes = useMemo(() => {
    if (!isMaster || !rows) return [] as MasterTargetListAthlete[];
    const byId = new Map<string, MasterTargetListAthlete>();
    for (const row of rows) {
      for (const athlete of row.assigned_athletes ?? []) {
        if (!byId.has(athlete.athlete_id)) byId.set(athlete.athlete_id, athlete);
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [isMaster, rows]);

  const visibleRowIndexes = useMemo(() => {
    if (!rows) return new Set<number>();
    const indexes = new Set<number>();
    rows.forEach((r, i) => {
      if (isMaster && activeAthleteFilter !== "all") {
        const assigned = r.assigned_athletes ?? [];
        if (!assigned.some((a) => a.athlete_id === activeAthleteFilter)) return;
      }
      if (activeCategoryFilter === TARGET_LIST_CATEGORY_FILTER_ALL) {
        indexes.add(i);
        return;
      }
      if (activeCategoryFilter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED) {
        if (isEffectivelyUncategorizedCompanyCategory(r.category)) indexes.add(i);
        return;
      }
      if (String(r.category ?? "").trim().toLowerCase() === activeCategoryFilter.toLowerCase()) {
        indexes.add(i);
      }
    });
    return indexes;
  }, [rows, activeCategoryFilter, isMaster, activeAthleteFilter]);

  const flat = useMemo(() => {
    if (!rows) return [];
    return buildFlatRows(rows).filter((fr) => visibleRowIndexes.has(fr.rowIndex));
  }, [rows, visibleRowIndexes]);

  const getSessionContext = useCallback(() => {
    if (!rows) return "";
    if (isAthlete && athleteId) {
      return buildTargetListSessionContext({
        athleteId,
        athleteName,
        activeCategoryFilter,
        rows,
        selectedCompanyIds,
        focusedRow,
      });
    }
    if (isMaster) {
      return buildMasterTargetListSessionContext({
        activeCategoryFilter,
        activeAthleteFilter,
        rosterAthletes: masterRosterAthletes,
        rows: rows.map((r) => ({
          pipeline_id: r.pipeline_id,
          company_id: r.company_id,
          company_name: r.company_name,
          category: r.category,
          match_score: r.match_score,
          assigned_athletes: r.assigned_athletes ?? [],
          contacts: r.contacts.map((c) => ({
            contact_id: c.contact_id,
            first_name: c.first_name,
            last_name: c.last_name,
          })),
        })),
        selectedCompanyIds,
        focusedRow,
      });
    }
    return "";
  }, [
    athleteId,
    athleteName,
    activeCategoryFilter,
    activeAthleteFilter,
    masterRosterAthletes,
    rows,
    selectedCompanyIds,
    focusedRow,
    isAthlete,
    isMaster,
  ]);

  useEffect(() => {
    if (!isAthlete || !athleteId) return;
    writeTargetListSessionContext(athleteId, getSessionContext());
  }, [athleteId, getSessionContext, isAthlete]);

  const persistSessionContextForDeepLink = useCallback(() => {
    if (!isAthlete || !athleteId) return;
    writeTargetListSessionContext(athleteId, getSessionContext());
  }, [athleteId, getSessionContext, isAthlete]);

  const refreshAfterAiMutation = useCallback(async () => {
    const toFlash = new Set<string>();
    if (focusedRow) toFlash.add(focusedRow.pipelineId);
    for (const r of rows ?? []) {
      if (selectedCompanyIds.has(r.company_id)) toFlash.add(r.pipeline_id);
    }
    flashAfterLoadRef.current = toFlash.size > 0 ? toFlash : new Set(rows?.map((r) => r.pipeline_id));
    setUpdateToast("Target list updated");
    await load();
  }, [load, rows, focusedRow, selectedCompanyIds]);

  useEffect(() => {
    const pending = flashAfterLoadRef.current;
    if (!pending || pending.size === 0) return;
    flashAfterLoadRef.current = null;
    setFlashedPipelineIds(pending);
    const t = window.setTimeout(() => setFlashedPipelineIds(new Set()), 2200);
    return () => window.clearTimeout(t);
  }, [rows]);

  useEffect(() => {
    if (!updateToast) return;
    const t = window.setTimeout(() => setUpdateToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [updateToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusMode) {
        const t = e.target as HTMLElement;
        if (t.closest("input, textarea, select, [contenteditable=true]")) return;
        e.preventDefault();
        setFocusModePersisted(false);
        return;
      }
      if ((isAthlete || isMaster) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiDockCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, setFocusModePersisted, isAthlete, isMaster]);

  function toggleCompanySelected(companyId: string, checked: boolean) {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(companyId);
      else next.delete(companyId);
      return next;
    });
  }

  function focusFlatRow(fr: FlatRow) {
    const row = rows?.[fr.rowIndex];
    if (!row) return;
    const contact = fr.contactIndex != null ? row.contacts[fr.contactIndex] : null;
    setFocusedRow({
      pipelineId: row.pipeline_id,
      companyId: row.company_id,
      companyName: row.company_name,
      category: row.category,
      contactId: contact?.contact_id ?? null,
      contactName: contact
        ? formatContactDisplayName(contact.first_name, contact.last_name) || null
        : null,
      rowIndex: fr.rowIndex,
      contactIndex: fr.contactIndex,
    });
  }

  /* Update local state after a save so the UI stays in sync. */
  function patchRowLocal(rowIndex: number, patch: Partial<TargetListRow>) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next[rowIndex] = { ...next[rowIndex], ...patch };
      return Object.prototype.hasOwnProperty.call(patch, "match_score")
        ? sortTargetListRows(next)
        : next;
    });
  }
  function patchContactLocal(rowIndex: number, contactIndex: number, patch: Partial<TargetListContact>) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      const row = { ...next[rowIndex] };
      const contacts = row.contacts.slice();
      contacts[contactIndex] = { ...contacts[contactIndex], ...patch };
      row.contacts = contacts;
      next[rowIndex] = row;
      return next;
    });
  }

  function applyCompanyContactsToRows(
    companyId: string,
    apiContacts: unknown[],
    meta?: { hq_phone?: string | null }
  ) {
    const contacts = (Array.isArray(apiContacts) ? apiContacts : []).map((c) =>
      mapApiContactToTargetList(c as Record<string, unknown>)
    );
    setRows((prev) => {
      if (!prev) return prev;
      let next = mergeCompanyContactsIntoRows(prev, companyId, contacts) as TargetListRow[];
      if (meta?.hq_phone !== undefined) {
        next = next.map((row) =>
          row.company_id === companyId ? { ...row, hq_phone: meta.hq_phone ?? null } : row
        );
      }
      return next;
    });
  }

  function removeContactLocal(contactId: string) {
    setRows((prev) => (prev ? (removeContactFromRows(prev, contactId) as TargetListRow[]) : prev));
    setSelectedContactIds((prev) => {
      if (!prev.has(contactId)) return prev;
      const next = new Set(prev);
      next.delete(contactId);
      return next;
    });
  }

  function removeContactsLocal(contactIds: string[]) {
    const idSet = new Set(contactIds);
    setRows((prev) => (prev ? (removeContactsFromRows(prev, idSet) as TargetListRow[]) : prev));
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      for (const id of contactIds) next.delete(id);
      return next;
    });
  }

  function requestBulkDeleteContacts(
    companyId: string,
    contactIds: string[],
    mode: "unrevealed" | "selected" | "duplicates"
  ) {
    if (contactIds.length === 0) return;
    if (isTargetListDialogDismissed(TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY)) {
      void bulkDeleteContacts(companyId, contactIds);
      return;
    }
    setBulkDeleteConfirm({ companyId, contactIds, mode });
  }

  async function bulkDeleteContacts(_companyId: string, contactIds: string[]) {
    if (contactIds.length === 0) return;
    setDeletingContactsCompanyId(_companyId);
    setGlobalError(null);
    try {
      const deleted = await batchDeleteCrmContacts(contactIds);
      if (deleted.length === 0) throw new Error("No contacts were deleted");
      removeContactsLocal(deleted);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingContactsCompanyId(null);
    }
  }

  function requestBulkRemoveUnrevealedAll() {
    if (unrevealedContactIds.length === 0) return;
    if (isTargetListDialogDismissed(TARGET_LIST_REMOVE_UNREVEALED_ALL_DISMISS_KEY)) {
      void bulkRemoveUnrevealedAll();
      return;
    }
    setBulkRemoveUnrevealedConfirmOpen(true);
  }

  async function bulkRemoveUnrevealedAll() {
    if (unrevealedContactIds.length === 0) return;
    setBulkRemoveUnrevealed(true);
    setGlobalError(null);
    try {
      const deleted = await batchDeleteCrmContacts(unrevealedContactIds);
      if (deleted.length === 0) throw new Error("No contacts were deleted");
      removeContactsLocal(deleted);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Remove unrevealed failed");
    } finally {
      setBulkRemoveUnrevealed(false);
    }
  }

  async function saveMatchScore(
    rowIndex: number,
    nextScore: number | null,
    scoreAthleteId?: string
  ) {
    const row = rows?.[rowIndex];
    if (!row) return;
    const resolvedAthleteId = scoreAthleteId ?? athleteId;
    if (!resolvedAthleteId) throw new Error("Select an athlete to update match score");
    const res = await fetch(`/api/crm/pipeline/${row.pipeline_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        athlete_id: resolvedAthleteId,
        athlete_match_score: nextScore,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Save failed");
    }
  }

  async function savePipelinePatch(rowIndex: number, patch: Record<string, unknown>) {
    const row = rows?.[rowIndex];
    if (!row) return;
    const res = await fetch(`/api/crm/pipeline/${row.pipeline_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Save failed");
    }
  }

  async function saveContactPatch(rowIndex: number, contactIndex: number, patch: Record<string, unknown>) {
    const contact = rows?.[rowIndex]?.contacts[contactIndex];
    if (!contact) return;
    const res = await fetch(`/api/crm/contacts/${contact.contact_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || "Save failed");
    }
  }

  async function createContactForRow(rowIndex: number, patch: Record<string, string>) {
    const row = rows?.[rowIndex];
    if (!row) return;
    const payload = {
      first_name: patch.first_name ?? "",
      last_name: patch.last_name ?? "",
      company_name: row.company_name,
      role: patch.role ?? null,
      email: patch.email ?? null,
      phone: patch.phone ?? null,
    };
    if (!payload.first_name || !payload.last_name) {
      throw new Error("First and last name required");
    }
    const res = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Create failed");

    // Link the new contact to athlete(s) so it shows up in outreach flows.
    try {
      const athleteIdsToLink = isMaster
        ? (row.assigned_athletes ?? []).map((a) => a.athlete_id)
        : athleteId
          ? [athleteId]
          : [];
      if (athleteIdsToLink.length > 0) {
        await fetch(`/api/crm/contacts/${data.contact.contact_id}/athletes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ athlete_ids: athleteIdsToLink }),
        });
      }
    } catch {
      // ignore; linking is best-effort
    }

    // Reload to get the full contact row with its new id.
    await load();
  }

  function requestBulkFindContacts() {
    if (!rows || rows.length === 0) return;
    if (isTargetListDialogDismissed(TARGET_LIST_FIND_CONTACTS_DISMISS_KEY)) {
      void findContactsForAllCompanies();
      return;
    }
    setBulkFindConfirmOpen(true);
  }

  async function removeCompanyFromTargetList(
    pipelineId: string,
    athleteIdsToRemove?: string[]
  ) {
    setRemovingPipelineId(pipelineId);
    setGlobalError(null);
    try {
      if (isMaster && athleteIdsToRemove && athleteIdsToRemove.length > 0) {
        for (const aid of athleteIdsToRemove) {
          const res = await fetch(`/api/athletes/${aid}/target-list`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ pipeline_id: pipelineId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Remove failed");
        }
        await load();
        return;
      }
      if (!athleteId) throw new Error("Missing athlete context");
      const res = await fetch(`/api/athletes/${athleteId}/target-list`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pipeline_id: pipelineId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Remove failed");
      setRows((prev) => prev?.filter((r) => r.pipeline_id !== pipelineId) ?? prev);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemovingPipelineId(null);
    }
  }

  function requestRemoveCompany(
    pipelineId: string,
    companyName: string,
    assignedAthletes?: MasterTargetListAthlete[]
  ) {
    if (isMaster) {
      const ids = (assignedAthletes ?? []).map((a) => a.athlete_id);
      setRemoveConfirm({
        pipelineId,
        companyName,
        assignedAthletes,
        selectedAthleteIds: ids,
      });
      return;
    }
    if (isTargetListDialogDismissed(TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY)) {
      void removeCompanyFromTargetList(pipelineId);
      return;
    }
    setRemoveConfirm({ pipelineId, companyName, selectedAthleteIds: [] });
  }

  async function findContactsForAllCompanies() {
    if (!rows || rows.length === 0) return;
    setBulkFindContacts(true);
    setGlobalError(null);
    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    try {
      const body: Record<string, unknown> = {
        company_ids: companyIds,
        ...contactSearchOverridesToRequestBody(apolloSearchOverrides),
      };
      const res = await fetch("/api/apollo/companies/bulk-find-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Bulk find contacts failed");
      if (data.summary?.failed > 0) {
        setGlobalError(
          `Find contacts: ${data.summary.succeeded}/${data.summary.companies} companies succeeded (${data.summary.total_created} new contacts).`
        );
      }
      for (const result of Array.isArray(data.results) ? data.results : []) {
        if (result?.ok && result.company_id) {
          applyCompanyContactsToRows(String(result.company_id), result.contacts ?? [], {
            hq_phone: result.hq_phone ?? null,
          });
        }
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Find contacts failed");
    } finally {
      setBulkFindContacts(false);
    }
  }

  async function handleExport() {
    if (!rows || rows.length === 0) return;
    setExporting(true);
    setGlobalError(null);
    try {
      const safeName = isMaster
        ? "master-target-list"
        : (athleteName ?? "athlete").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "athlete";
      await exportTargetListToExcel({
        columns,
        rows,
        fileName: `${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Failed to export Excel");
    } finally {
      setExporting(false);
    }
  }

  async function saveContactOutreachDraft(
    rowIndex: number,
    contactIndex: number,
    subject: string,
    body: string
  ) {
    const contact = rows?.[rowIndex]?.contacts[contactIndex];
    if (!contact) return;
    const draftAthleteId =
      athleteId ?? rows?.[rowIndex]?.assigned_athletes?.[0]?.athlete_id ?? null;
    if (!draftAthleteId) {
      throw new Error("No athlete context for outreach draft");
    }
    const email_drafts = upsertContactOutreachDraft(
      contact.email_drafts,
      draftAthleteId,
      subject,
      body
    );
    await saveContactPatch(rowIndex, contactIndex, { email_drafts });
    patchContactLocal(rowIndex, contactIndex, {
      email_drafts,
      outreach_email_subject: subject || null,
      outreach_email: body || null,
    });
  }

  async function applyPartnershipResearchResult(
    rowIndex: number,
    pipelineId: string,
    data: Record<string, unknown>
  ) {
    const found = data.found !== false;
    if (found) {
      const next = String(data.past_partnerships ?? "").trim();
      patchRowLocal(rowIndex, { past_partnerships: next || null });
      setPartnershipResearchErrorByPipelineId((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors[pipelineId];
        return nextErrors;
      });
    } else {
      const sourceCount = Array.isArray(data.source_urls) ? data.source_urls.length : 0;
      const evidenceCount =
        typeof data.evidence_count === "number" ? data.evidence_count : sourceCount;
      const msg = formatNoPartnershipsMessage({
        research_backend: String(data.research_backend ?? ""),
        source_url_count: sourceCount,
        evidence_count: evidenceCount,
      });
      setPartnershipResearchErrorByPipelineId((prev) => ({
        ...prev,
        [pipelineId]: msg,
      }));
    }

    const row = rows?.[rowIndex];
    const html = typeof data.search_entry_point_html === "string" ? data.search_entry_point_html : null;
    if (html && row) {
      setSearchDisclosureHtml(html);
      setSearchDisclosureCompany(row.company_name);
    }
    const queries = Array.isArray(data.web_search_queries)
      ? data.web_search_queries.map((q: unknown) => String(q ?? "").trim()).filter(Boolean)
      : [];
    if (queries.length > 0) {
      setSearchQueries(queries);
    }
  }

  async function researchPartnershipsForRow(rowIndex: number) {
    const row = rows?.[rowIndex];
    if (!row) return;
    setResearchingPipelineId(row.pipeline_id);
    setPartnershipResearchErrorByPipelineId((prev) => {
      const next = { ...prev };
      delete next[row.pipeline_id];
      return next;
    });
    try {
      const res = await fetch(`/api/crm/pipeline/${row.pipeline_id}/research-partnerships`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = formatPartnershipResearchClientError(data);
        setPartnershipResearchErrorByPipelineId((prev) => ({ ...prev, [row.pipeline_id]: msg }));
        return;
      }
      await applyPartnershipResearchResult(rowIndex, row.pipeline_id, data as Record<string, unknown>);
    } catch (e) {
      setPartnershipResearchErrorByPipelineId((prev) => ({
        ...prev,
        [row.pipeline_id]: e instanceof Error ? e.message : "Research failed",
      }));
    } finally {
      setResearchingPipelineId(null);
    }
  }

  async function researchPartnershipsForAllCompanies() {
    if (!rows || rows.length === 0) return;
    setBulkPartnershipResearch(true);
    setBulkPartnershipIndex(0);
    setGlobalError(null);
    setSearchDisclosureHtml(null);
    setSearchDisclosureCompany(null);
    setSearchQueries([]);
    setPartnershipResearchErrorByPipelineId({});
    const failures: string[] = [];
    let succeeded = 0;
    const bulkDelayMs = partnershipResearchBulkDelayMs();
    try {
      for (let i = 0; i < rows.length; i++) {
        if (i > 0 && bulkDelayMs > 0) {
          await sleepMs(bulkDelayMs);
        }
        setBulkPartnershipIndex(i + 1);
        const row = rows[i]!;
        const res = await fetch(`/api/crm/pipeline/${row.pipeline_id}/research-partnerships`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          failures.push(`${row.company_name}: ${formatPartnershipResearchClientError(data)}`);
          setPartnershipResearchErrorByPipelineId((prev) => ({
            ...prev,
            [row.pipeline_id]: formatPartnershipResearchClientError(data),
          }));
          continue;
        }
        await applyPartnershipResearchResult(i, row.pipeline_id, data as Record<string, unknown>);
        if (data.found !== false) {
          succeeded += 1;
        } else {
          failures.push(`${row.company_name}: No relevant deals found.`);
        }
      }
      if (failures.length > 0) {
        const summary = `Partnership research: ${succeeded}/${rows.length} with results.`;
        setGlobalError(
          failures.length <= 3
            ? `${summary} ${failures.join(" ")}`
            : `${summary} ${failures.slice(0, 3).join(" ")} (+${failures.length - 3} more — see row errors)`
        );
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Partnership research failed");
    } finally {
      setBulkPartnershipResearch(false);
      setBulkPartnershipIndex(0);
    }
  }

  const bulkActionBtnClass =
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50";

  const listShell = (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-[#151A17]",
        focusMode
          ? "fixed inset-x-0 bottom-0 z-40 border-t border-white/10 shadow-2xl"
          : cn("flex-1 rounded-lg border border-white/10", className)
      )}
      style={focusMode ? { top: navOffsetPx } : undefined}
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-white/10",
          focusMode ? "px-3 py-2" : "px-4 py-3"
        )}
      >
        {focusMode ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-[#F4F1EB]">{pageTitle}</h3>
              {rows && rows.length > 0 ? (
                <span className="shrink-0 whitespace-nowrap text-xs text-[#8E877A]">
                  {rows.length} {rows.length === 1 ? "company" : "companies"}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div ref={bulkActionsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setBulkActionsOpen((o) => !o)}
                  disabled={bulkActionsDisabled && !bulkFindContacts && !bulkPartnershipResearch && !exporting}
                  className={cn(
                    bulkActionBtnClass,
                    "border-white/15 bg-[#1A211D] text-[#D7D0C4] hover:bg-white/5"
                  )}
                >
                  Bulk actions
                </button>
                {bulkActionsOpen ? (
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-white/10 bg-[#151A17] py-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setBulkActionsOpen(false);
                        requestBulkFindContacts();
                      }}
                      disabled={bulkActionsDisabled}
                      className="block w-full px-3 py-2 text-left text-xs text-[#D7D0C4] hover:bg-white/5 disabled:opacity-50"
                    >
                      {bulkFindContacts ? "Finding contacts…" : "Find contacts (all)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkActionsOpen(false);
                        requestBulkRemoveUnrevealedAll();
                      }}
                      disabled={bulkActionsDisabled || unrevealedContactIds.length === 0}
                      className="block w-full px-3 py-2 text-left text-xs text-[#D7D0C4] hover:bg-white/5 disabled:opacity-50"
                    >
                      {bulkRemoveUnrevealed
                        ? "Removing unrevealed…"
                        : `Remove unrevealed (all)${unrevealedContactIds.length > 0 ? ` (${unrevealedContactIds.length})` : ""}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkActionsOpen(false);
                        void researchPartnershipsForAllCompanies();
                      }}
                      disabled={bulkActionsDisabled}
                      className="block w-full px-3 py-2 text-left text-xs text-[#D7D0C4] hover:bg-white/5 disabled:opacity-50"
                    >
                      {bulkPartnershipResearch
                        ? `Researching ${bulkPartnershipIndex}/${rows?.length ?? 0}…`
                        : "Research partnerships (all)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkActionsOpen(false);
                        void handleExport();
                      }}
                      disabled={bulkActionsDisabled || exporting}
                      className="block w-full px-3 py-2 text-left text-xs text-[#D7D0C4] hover:bg-white/5 disabled:opacity-50"
                    >
                      {exporting ? "Exporting…" : "Export to Excel"}
                    </button>
                    {isAthlete && athleteName && athleteId ? (
                      <Link
                        href={`/ai?athlete_id=${encodeURIComponent(athleteId)}&context=target_list&athlete_name=${encodeURIComponent(athleteName)}`}
                        className="block px-3 py-2 text-left text-xs text-[#CEE4D4] hover:bg-white/5"
                        onClick={() => {
                          persistSessionContextForDeepLink();
                          setBulkActionsOpen(false);
                        }}
                      >
                        Prospect & import in Mystery Machine
                      </Link>
                    ) : isMaster ? (
                      <Link
                        href="/ai"
                        className="block px-3 py-2 text-left text-xs text-[#CEE4D4] hover:bg-white/5"
                        onClick={() => setBulkActionsOpen(false)}
                      >
                        Open Mystery Machine
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {isAthlete || isMaster ? (
                <button
                  type="button"
                  onClick={() => setAiDockCollapsed((c) => !c)}
                  className={cn(
                    bulkActionBtnClass,
                    "border-[#2E7040]/60 bg-[#173522] text-[#DBEEE0] hover:bg-[#1F4730]"
                  )}
                  title="Toggle Target List AI (⌘J)"
                >
                  {aiDockCollapsed ? "Open AI" : "AI open"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setFocusModePersisted(false)}
                className={cn(
                  bulkActionBtnClass,
                  "border-white/15 bg-[#1A211D] text-[#D7D0C4] hover:bg-white/5"
                )}
                title="Exit focus mode (Esc)"
              >
                <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                Exit focus
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-[#F4F1EB]">{pageTitle}</h3>
                <button
                  type="button"
                  onClick={() => setFocusModePersisted(true)}
                  className={cn(
                    bulkActionBtnClass,
                    "border-white/15 bg-[#1A211D] text-[#D7D0C4] hover:bg-white/5"
                  )}
                  title="Expand spreadsheet — hide athlete header and tabs"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  Expand
                </button>
              </div>
              <p className="mt-0.5 text-xs text-[#B9B2A6]">
                {isMaster
                  ? "Every company on your roster athletes' target lists in one view. Click any cell to edit in place; changes sync to the CRM. Rows without a contact are highlighted."
                  : "Every company prospected and assigned to this athlete in your CRM pipeline. Click any cell to edit in place; changes sync to the CRM. Rows without a contact are highlighted."}
              </p>
              {isAthlete && athleteName && athleteId ? (
                <Link
                  href={`/ai?athlete_id=${encodeURIComponent(athleteId)}&context=target_list&athlete_name=${encodeURIComponent(athleteName)}`}
                  className="mt-1 inline-block text-xs text-[#CEE4D4] underline hover:text-[#E8F6ED]"
                  onClick={persistSessionContextForDeepLink}
                >
                  Prospect & import in Mystery Machine
                </Link>
              ) : isMaster ? (
                <Link
                  href="/ai"
                  className="mt-1 inline-block text-xs text-[#CEE4D4] underline hover:text-[#E8F6ED]"
                >
                  Open Mystery Machine
                </Link>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
              {rows && rows.length > 0 ? (
                <span className="whitespace-nowrap text-xs text-[#B9B2A6]">
                  {rows.length} {rows.length === 1 ? "company" : "companies"}
                </span>
              ) : null}
              {isAthlete || isMaster ? (
                <button
                  type="button"
                  onClick={() => setAiDockCollapsed((c) => !c)}
                  className={cn(
                    bulkActionBtnClass,
                    "border-[#2E7040]/60 bg-[#173522] text-[#DBEEE0] hover:bg-[#1F4730]"
                  )}
                  title="Toggle Target List AI (⌘J)"
                >
                  {aiDockCollapsed ? (
                    <>
                      Open AI assistant <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                    </>
                  ) : (
                    "AI assistant open"
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => requestBulkFindContacts()}
                disabled={bulkActionsDisabled}
                className={cn(
                  bulkActionBtnClass,
                  "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]"
                )}
                title={formatApolloPartnershipSearchSummary()}
              >
                {bulkFindContacts ? (
                  <>
                    <span
                      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#DBEEE0]/25 border-t-[#DBEEE0]"
                      aria-hidden
                    />
                    Finding contacts…
                  </>
                ) : (
                  "Find contacts (all)"
                )}
              </button>
              <button
                type="button"
                onClick={() => requestBulkRemoveUnrevealedAll()}
                disabled={bulkActionsDisabled || unrevealedContactIds.length === 0}
                className={cn(
                  bulkActionBtnClass,
                  "border-[#8C3A3A]/50 bg-[#2A1818] text-[#F1A2A2] hover:bg-[#3A1E1E]"
                )}
                title="Remove all Apollo contact candidates that have not been revealed yet"
              >
                {bulkRemoveUnrevealed
                  ? "Removing unrevealed…"
                  : `Remove unrevealed (all)${unrevealedContactIds.length > 0 ? ` (${unrevealedContactIds.length})` : ""}`}
              </button>
              <button
                type="button"
                onClick={() => void researchPartnershipsForAllCompanies()}
                disabled={bulkActionsDisabled}
                className={cn(
                  bulkActionBtnClass,
                  "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]"
                )}
                title="Web search + Gemini for each company; bullets cite search result URLs only"
              >
                {bulkPartnershipResearch
                  ? `Researching ${bulkPartnershipIndex}/${rows?.length ?? 0}…`
                  : "Research partnerships (all)"}
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={bulkActionsDisabled || exporting}
                className={cn(
                  bulkActionBtnClass,
                  "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]"
                )}
              >
                {exporting ? "Exporting…" : "Export to Excel"}
              </button>
            </div>
          </>
        )}
      </header>

      <TargetListActionDialog
        open={bulkFindConfirmOpen}
        title="Find contacts for all companies?"
        description={
          <>
            <p>
              Run Apollo contact search for every company on this list ({rows?.length ?? 0}{" "}
              {rows?.length === 1 ? "company" : "companies"}).
            </p>
            <p>{formatApolloPartnershipSearchSummary()}</p>
            <p className="text-[#AEA79A]">
              Apollo search does not use credits. Revealing an email later uses Apollo credits.
            </p>
          </>
        }
        confirmLabel="Find contacts (all)"
        dismissStorageKey={TARGET_LIST_FIND_CONTACTS_DISMISS_KEY}
        onCancel={() => setBulkFindConfirmOpen(false)}
        onConfirm={() => {
          setBulkFindConfirmOpen(false);
          void findContactsForAllCompanies();
        }}
      />

      <TargetListActionDialog
        open={removeConfirm != null}
        title="Remove from target list?"
        variant="danger"
        description={
          removeConfirm ? (
            isMaster && (removeConfirm.assignedAthletes?.length ?? 0) > 0 ? (
              <>
                <p>
                  Remove{" "}
                  <span className="font-medium text-[#E6E0D5]">{removeConfirm.companyName}</span> from selected
                  athletes&apos; target lists.
                </p>
                <div className="mt-2 space-y-1">
                  {(removeConfirm.assignedAthletes ?? []).map((athlete) => (
                    <label key={athlete.athlete_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={removeConfirm.selectedAthleteIds.includes(athlete.athlete_id)}
                        onChange={(e) => {
                          setRemoveConfirm((prev) => {
                            if (!prev) return prev;
                            const nextIds = new Set(prev.selectedAthleteIds);
                            if (e.target.checked) nextIds.add(athlete.athlete_id);
                            else nextIds.delete(athlete.athlete_id);
                            return { ...prev, selectedAthleteIds: [...nextIds] };
                          });
                        }}
                      />
                      {athlete.name}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[#AEA79A]">
                  The company stays in your CRM pipeline. You can add it back later from the CRM.
                </p>
              </>
            ) : (
              <>
                <p>
                  <span className="font-medium text-[#E6E0D5]">{removeConfirm.companyName}</span> will be
                  removed from this athlete&apos;s target list.
                </p>
                <p className="text-[#AEA79A]">
                  The company stays in your CRM pipeline. You can add it back later from the CRM.
                </p>
              </>
            )
          ) : null
        }
        confirmLabel="Remove"
        dismissStorageKey={TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY}
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          const target = removeConfirm;
          setRemoveConfirm(null);
          if (!target) return;
          if (isMaster) {
            void removeCompanyFromTargetList(target.pipelineId, target.selectedAthleteIds);
            return;
          }
          void removeCompanyFromTargetList(target.pipelineId);
        }}
      />

      <TargetListActionDialog
        open={bulkRemoveUnrevealedConfirmOpen}
        title="Remove unrevealed contacts (all companies)?"
        variant="danger"
        description={
          <>
            <p>
              Remove {unrevealedContactIds.length} Apollo contact{" "}
              {unrevealedContactIds.length === 1 ? "candidate" : "candidates"} across the target list
              that haven&apos;t been revealed. No credits were used for these contacts.
            </p>
            <p className="text-[#AEA79A]">You can find contacts again later with Find contacts.</p>
          </>
        }
        confirmLabel="Remove unrevealed (all)"
        dismissStorageKey={TARGET_LIST_REMOVE_UNREVEALED_ALL_DISMISS_KEY}
        onCancel={() => setBulkRemoveUnrevealedConfirmOpen(false)}
        onConfirm={() => {
          setBulkRemoveUnrevealedConfirmOpen(false);
          void bulkRemoveUnrevealedAll();
        }}
      />

      <TargetListActionDialog
        open={bulkDeleteConfirm != null}
        title={
          bulkDeleteConfirm?.mode === "duplicates"
            ? "Remove duplicate contacts?"
            : bulkDeleteConfirm?.mode === "unrevealed"
            ? "Remove unrevealed contacts?"
            : bulkDeleteConfirm &&
                rows
                  ?.find((r) => r.company_id === bulkDeleteConfirm.companyId)
                  ?.contacts.some(
                    (c) =>
                      bulkDeleteConfirm.contactIds.includes(c.contact_id) &&
                      c.apollo_reveal_status === "revealed"
                  )
              ? "Delete contacts from CRM?"
              : "Remove Apollo contacts?"
        }
        variant="danger"
        description={
          bulkDeleteConfirm ? (
            bulkDeleteConfirm.mode === "duplicates" ? (
              <>
                <p>
                  Remove {bulkDeleteConfirm.contactIds.length} older duplicate{" "}
                  {bulkDeleteConfirm.contactIds.length === 1 ? "entry" : "entries"} for the same
                  person. The Apollo-linked contact with email will be kept.
                </p>
                <p className="text-[#AEA79A]">This cannot be undone.</p>
              </>
            ) : bulkDeleteConfirm.mode === "unrevealed" ? (
              <>
                <p>
                  Remove {bulkDeleteConfirm.contactIds.length} Apollo contact{" "}
                  {bulkDeleteConfirm.contactIds.length === 1 ? "candidate" : "candidates"} that
                  haven&apos;t been revealed. No credits were used.
                </p>
                <p className="text-[#AEA79A]">You can find contacts again later with Find contacts.</p>
              </>
            ) : rows
                ?.find((r) => r.company_id === bulkDeleteConfirm.companyId)
                ?.contacts.some(
                  (c) =>
                    bulkDeleteConfirm.contactIds.includes(c.contact_id) &&
                    c.apollo_reveal_status === "revealed"
                ) ? (
              <>
                <p>
                  {bulkDeleteConfirm.contactIds.length}{" "}
                  {bulkDeleteConfirm.contactIds.length === 1 ? "contact" : "contacts"} will be removed
                  from your CRM, including any saved email and LinkedIn data.
                </p>
                <p className="text-[#AEA79A]">This cannot be undone.</p>
              </>
            ) : (
              <>
                <p>
                  Remove {bulkDeleteConfirm.contactIds.length} Apollo contact{" "}
                  {bulkDeleteConfirm.contactIds.length === 1 ? "candidate" : "candidates"} from the
                  target list. No credits were used for these contacts.
                </p>
                <p className="text-[#AEA79A]">You can find contacts again later with Find contacts.</p>
              </>
            )
          ) : null
        }
        confirmLabel="Delete"
        dismissStorageKey={TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY}
        onCancel={() => setBulkDeleteConfirm(null)}
        onConfirm={() => {
          const target = bulkDeleteConfirm;
          setBulkDeleteConfirm(null);
          if (target) void bulkDeleteContacts(target.companyId, target.contactIds);
        }}
      />

      {globalError ? (
        <div className="border-b border-[#8C3A3A]/50 bg-[#3A1E1E] px-4 py-2 text-xs text-[#F1A2A2]">{globalError}</div>
      ) : null}
      {searchDisclosureHtml ? (
        <div className="border-b border-white/10 bg-[#121713] px-4 py-2 text-xs text-[#B9B2A6]">
          <details>
            <summary className="cursor-pointer">
              Google Search suggestions disclosure{searchDisclosureCompany ? ` (${searchDisclosureCompany})` : ""}
            </summary>
            {/* Required disclosure content returned by grounding metadata. */}
            <div className="prose prose-invert mt-2 max-w-none text-xs" dangerouslySetInnerHTML={{ __html: searchDisclosureHtml }} />
            {searchQueries.length > 0 ? <div className="mt-2">Search queries: {searchQueries.join(" | ")}</div> : null}
          </details>
        </div>
      ) : null}

      {updateToast ? (
        <div className="border-b border-[#2E7040]/40 bg-[#1B2F21] px-4 py-2 text-xs text-[#DBEEE0]">{updateToast}</div>
      ) : null}

      {rows && rows.length > 0 ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-b border-white/10",
            focusMode ? "overflow-x-auto px-3 py-1.5 flex-nowrap" : "flex-wrap px-4 py-2"
          )}
        >
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">Category</span>
          <button
            type="button"
            onClick={() => setActiveCategoryFilter(TARGET_LIST_CATEGORY_FILTER_ALL)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              activeCategoryFilter === TARGET_LIST_CATEGORY_FILTER_ALL
                ? "bg-[#2E7040] text-[#F2FFF5]"
                : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
            )}
          >
            All ({categorySummary.total})
          </button>
          {categorySummary.uncategorized > 0 ? (
            <button
              type="button"
              onClick={() => setActiveCategoryFilter(TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                activeCategoryFilter === TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED
                  ? "bg-[#2E7040] text-[#F2FFF5]"
                  : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
              )}
            >
              Uncategorized ({categorySummary.uncategorized})
            </button>
          ) : null}
          {categorySummary.sorted.map(([cat, count]) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategoryFilter(cat)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                activeCategoryFilter === cat
                  ? "bg-[#2E7040] text-[#F2FFF5]"
                  : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
              )}
            >
              {cat} ({count})
            </button>
          ))}
          {isMaster && masterRosterAthletes.length > 0 ? (
            <>
              <span className="ml-2 mr-1 text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">
                Athlete
              </span>
              <button
                type="button"
                onClick={() => setActiveAthleteFilter("all")}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  activeAthleteFilter === "all"
                    ? "bg-[#2E7040] text-[#F2FFF5]"
                    : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
                )}
              >
                All athletes
              </button>
              {masterRosterAthletes.map((athlete) => (
                <button
                  key={athlete.athlete_id}
                  type="button"
                  onClick={() => setActiveAthleteFilter(athlete.athlete_id)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    activeAthleteFilter === athlete.athlete_id
                      ? "bg-[#2E7040] text-[#F2FFF5]"
                      : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
                  )}
                >
                  {athlete.name}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      {loading ? (
        <div className="p-4 text-sm text-[#B9B2A6]">Loading target list…</div>
      ) : error ? (
        <div className="p-4 text-sm text-[#F1A2A2]">{error}</div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-4 text-sm text-[#B9B2A6]">
          {isMaster ? (
            <>
              No companies on your roster athletes&apos; target lists yet. Assign athletes on pipeline cards in{" "}
              <Link href="/crm" className="text-[#CEE4D4] underline hover:text-[#E8F6ED]">
                the CRM
              </Link>
              .
            </>
          ) : (
            <>
              No target companies yet. Open{" "}
              <Link href="/crm" className="text-[#CEE4D4] underline hover:text-[#E8F6ED]">
                the CRM
              </Link>{" "}
              and assign this athlete on a pipeline card to populate this list.
            </>
          )}
        </div>
      ) : flat.length === 0 ? (
        <div className="p-4 text-sm text-[#B9B2A6]">No companies match this category filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#1A211D] text-[#D7D0C4]">
              <tr>
                {columns.map((c) => (
                  <Th
                    key={c}
                    className={
                      c === "Outreach Email" ? "w-72 min-w-[18rem] max-w-[24rem] normal-case tracking-normal" : undefined
                    }
                  >
                    {c}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flat.map((fr) => {
                const row = rows[fr.rowIndex];
                const contact =
                  fr.contactIndex != null ? row.contacts[fr.contactIndex] : null;
                const yellow = !fr.hasContact;
                const yellowCell = yellow ? "bg-[#3A3418]/90" : "";
                const fullName = contact
                  ? formatContactDisplayName(contact.first_name, contact.last_name)
                  : "";

                return (
                  <tr
                    key={fr.key}
                    className={cn(
                      "border-t border-white/10 align-top hover:bg-white/[0.03] cursor-pointer",
                      focusedRow?.pipelineId === row.pipeline_id &&
                        focusedRow.contactIndex === fr.contactIndex &&
                        "ring-1 ring-inset ring-[#2E7040]/50 bg-[#2E7040]/5",
                      flashedPipelineIds.has(row.pipeline_id) && "bg-[#2E7040]/12 transition-colors duration-500"
                    )}
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("button, a, input, textarea, select, label")) return;
                      focusFlatRow(fr);
                    }}
                  >
                    {/* Category */}
                    <Td>
                      {fr.showCategory ? (
                        <EditableCell
                          value={row.category}
                          placeholder="Category"
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, {
                              product_category: next || null,
                            });
                            patchRowLocal(fr.rowIndex, { category: next || null });
                          }}
                          display={(v) => (
                            <span className="font-medium text-[#F4F1EB]">
                              {v || UNCATEGORIZED_LABEL}
                            </span>
                          )}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Company */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <div className="space-y-1">
                          <label className="flex items-start gap-1.5">
                            <input
                              type="checkbox"
                              className="mt-1 shrink-0 rounded border-white/20 bg-transparent"
                              checked={selectedCompanyIds.has(row.company_id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleCompanySelected(row.company_id, e.target.checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${row.company_name}`}
                            />
                            <span className="min-w-0 flex-1">
                          <EditableCell
                            value={row.company_name}
                            placeholder="Company name"
                            onSave={async (next) => {
                              if (!next) throw new Error("Company name required");
                              await savePipelinePatch(fr.rowIndex, { company_name: next });
                              patchRowLocal(fr.rowIndex, { company_name: next });
                            }}
                            display={(v) => (
                              <Link
                                href={`/crm?pipeline_id=${row.pipeline_id}`}
                                className="font-medium text-[#CEE4D4] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v || "—"}
                              </Link>
                            )}
                          />
                            </span>
                          </label>
                          <ApolloFindContactsInline
                            companyId={row.company_id}
                            companyName={row.company_name}
                            searchOverrides={apolloSearchOverrides}
                            onRefineSearchClick={() => setRefineSearchOpen(true)}
                            disabled={bulkFindContacts || removingPipelineId === row.pipeline_id}
                            onContacts={(contacts, meta) =>
                              applyCompanyContactsToRows(row.company_id, contacts, meta)
                            }
                            onError={(msg) => setGlobalError(msg)}
                          />
                          <button
                            type="button"
                            className="block w-full rounded border border-[#8C3A3A]/50 bg-[#2A1818] px-1.5 py-0.5 text-[10px] font-medium text-[#F1A2A2] hover:bg-[#3A1E1E] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={
                              bulkFindContacts ||
                              bulkPartnershipResearch ||
                              removingPipelineId === row.pipeline_id ||
                              deletingContactsCompanyId === row.company_id
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              requestRemoveCompany(
                                row.pipeline_id,
                                row.company_name,
                                row.assigned_athletes
                              );
                            }}
                          >
                            {removingPipelineId === row.pipeline_id ? "Deleting…" : "Delete"}
                          </button>
                          <TargetListCompanyContactActions
                            contacts={row.contacts}
                            selectedContactIds={selectedContactIds}
                            onSelectedContactIdsChange={setSelectedContactIds}
                            onRequestBulkDelete={(contactIds, mode) =>
                              requestBulkDeleteContacts(row.company_id, contactIds, mode)
                            }
                            deleting={deletingContactsCompanyId === row.company_id}
                            disabled={
                              bulkFindContacts ||
                              bulkPartnershipResearch ||
                              removingPipelineId === row.pipeline_id
                            }
                          />
                        </div>
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {isMaster ? (
                      <Td className={yellowCell}>
                        {fr.showCompany ? (
                          <div className="flex flex-wrap gap-1">
                            {(row.assigned_athletes ?? []).map((athlete) => (
                              <Link
                                key={athlete.athlete_id}
                                href={`/athlete/${athlete.athlete_id}?tab=outreach`}
                                className="rounded border border-[#2E7040]/40 bg-[#1B2F21] px-1.5 py-0.5 text-[11px] text-[#DBEEE0] hover:bg-[#23452E]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {athlete.name}
                                {athlete.match_score != null ? ` (${formatMatchScore(athlete.match_score)})` : ""}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <span aria-hidden="true"></span>
                        )}
                      </Td>
                    ) : null}

                    {/* Company Website */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <EditableCell
                          value={row.website ?? ""}
                          placeholder="https://…"
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { company_website: next || null });
                            patchRowLocal(fr.rowIndex, { website: next || null });
                          }}
                          display={(v) => {
                            if (!v) return <span className="text-[#8E877A]">—</span>;
                            const safeUrl = safeHttpUrl(v);
                            if (!safeUrl) {
                              return <span className="break-all text-[#D7D0C4]">{v}</span>;
                            }
                            return (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-[#CEE4D4] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v.replace(/^https?:\/\//, "")}
                              </a>
                            );
                          }}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Match Score */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <EditableCell
                          value={formatMatchScore(row.match_score)}
                          placeholder="—"
                          onSave={async (next) => {
                            const parsed = parseMatchScoreInput(next);
                            const assigned = row.assigned_athletes ?? [];
                            if (isMaster && assigned.length > 1) {
                              setMatchScoreAthletePick({ rowIndex: fr.rowIndex, pendingScore: parsed });
                              return;
                            }
                            const scoreAthleteId =
                              isMaster && assigned.length === 1
                                ? assigned[0]!.athlete_id
                                : undefined;
                            await saveMatchScore(fr.rowIndex, parsed, scoreAthleteId);
                            patchRowLocal(fr.rowIndex, { match_score: parsed });
                          }}
                          display={(v) =>
                            v ? (
                              <span className="font-medium tabular-nums text-[#ECE7DF]">{v}</span>
                            ) : (
                              <span className="text-[#8E877A]">—</span>
                            )
                          }
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Contact Name */}
                    <Td className={yellowCell}>
                      <div className="flex items-start gap-1.5">
                        {contact && isBulkRemovableTargetListContact(contact, row.contacts) ? (
                          <input
                            type="checkbox"
                            className="mt-1 rounded border-white/20"
                            checked={selectedContactIds.has(contact.contact_id)}
                            disabled={deletingContactsCompanyId === row.company_id}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedContactIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(contact.contact_id);
                                else next.delete(contact.contact_id);
                                return next;
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <EditableCell
                            value={fullName}
                            placeholder="First Last"
                            onSave={async (next) => {
                              const { first, last } = splitName(next);
                              if (!first || !last) {
                                throw new Error("Enter first and last name");
                              }
                              if (contact) {
                                await saveContactPatch(fr.rowIndex, fr.contactIndex!, {
                                  first_name: first,
                                  last_name: last,
                                });
                                patchContactLocal(fr.rowIndex, fr.contactIndex!, {
                                  first_name: first,
                                  last_name: last,
                                });
                              } else {
                                await createContactForRow(fr.rowIndex, {
                                  first_name: first,
                                  last_name: last,
                                });
                              }
                            }}
                            display={(v) =>
                              contact ? (
                                <Link
                                  href={`/crm/contacts/${contact.contact_id}`}
                                  className="text-[#CEE4D4] hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {v || "—"}
                                </Link>
                              ) : (
                                <span className="italic text-[#AEA79A]">
                                  {v || "No contact — click to add"}
                                </span>
                              )
                            }
                          />
                        </div>
                      </div>
                    </Td>

                    {/* Role */}
                    <Td className={yellowCell}>
                      <EditableCell
                        value={contact?.role ?? ""}
                        placeholder="Role / Title"
                        disabled={!contact}
                        onSave={async (next) => {
                          if (!contact) return;
                          await saveContactPatch(fr.rowIndex, fr.contactIndex!, { role: next || null });
                          patchContactLocal(fr.rowIndex, fr.contactIndex!, { role: next || null });
                        }}
                      />
                    </Td>

                    {/* Email (Reveal / Delete for Apollo; editable when revealed or manual) */}
                    <Td className={yellowCell}>
                      {contact &&
                      (contact.apollo_reveal_status === "pending" ||
                        contact.apollo_reveal_status === "revealed") ? (
                        <ContactEmailCell
                          contactId={contact.contact_id}
                          email={contact.email}
                          apolloRevealStatus={contact.apollo_reveal_status ?? null}
                          hideDelete={!isDeletableTargetListContact(contact)}
                          onRevealed={(updated) => {
                            patchContactLocal(fr.rowIndex, fr.contactIndex!, {
                              email: (updated.email as string) ?? contact.email,
                              linkedin_url: (updated.linkedin_url as string) ?? contact.linkedin_url,
                              apollo_reveal_status: "revealed",
                              first_name: (updated.first_name as string) ?? contact.first_name,
                              last_name: (updated.last_name as string) ?? contact.last_name,
                              role: (updated.role as string) ?? contact.role,
                            });
                          }}
                          onDeleted={() => removeContactLocal(contact.contact_id)}
                        />
                      ) : (
                        <EditableCell
                          value={contact?.email ?? ""}
                          placeholder="name@company.com"
                          disabled={!contact}
                          onSave={async (next) => {
                            if (!contact) return;
                            await saveContactPatch(fr.rowIndex, fr.contactIndex!, { email: next || null });
                            patchContactLocal(fr.rowIndex, fr.contactIndex!, { email: next || null });
                          }}
                          display={(v) =>
                            v ? (
                              <a
                                href={`mailto:${v}`}
                                className="text-[#CEE4D4] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v}
                              </a>
                            ) : (
                              <span className="text-[#8E877A]">—</span>
                            )
                          }
                        />
                      )}
                    </Td>

                    {/* LinkedIn */}
                    <Td className={yellowCell}>
                      <ContactLinkedinCell
                        contactId={contact?.contact_id}
                        linkedinUrl={contact?.linkedin_url}
                        email={contact?.email}
                        firstName={contact?.first_name}
                        lastName={contact?.last_name}
                        apolloPersonId={contact?.apollo_person_id}
                        compact
                        onRevealed={(updated) => {
                          if (!contact) return;
                          patchContactLocal(fr.rowIndex, fr.contactIndex!, {
                            linkedin_url: (updated.linkedin_url as string) ?? contact.linkedin_url,
                            apollo_person_id:
                              (updated.apollo_person_id as string) ?? contact.apollo_person_id,
                            apollo_reveal_status: "revealed",
                            email: (updated.email as string) ?? contact.email,
                          });
                        }}
                      />
                    </Td>

                    {/* Number */}
                    <Td className={yellowCell}>
                      {contact && !contact.phone && contact.apollo_phone_reveal_status !== "revealed" ? (
                        <ContactPhoneCell
                          contactId={contact.contact_id}
                          phone={contact.phone}
                          apolloPersonId={contact.apollo_person_id}
                          apolloPhoneRevealStatus={contact.apollo_phone_reveal_status ?? null}
                          email={contact.email}
                          linkedinUrl={contact.linkedin_url}
                          firstName={contact.first_name}
                          lastName={contact.last_name}
                          compact
                          onRevealed={(updated) => {
                            patchContactLocal(fr.rowIndex, fr.contactIndex!, {
                              phone: (updated.phone as string) ?? contact.phone,
                              apollo_phone_reveal_status:
                                updated.apollo_phone_reveal_status === "pending" ||
                                updated.apollo_phone_reveal_status === "revealed"
                                  ? (updated.apollo_phone_reveal_status as "pending" | "revealed")
                                  : "pending",
                              apollo_person_id:
                                (updated.apollo_person_id as string) ?? contact.apollo_person_id,
                            });
                          }}
                        />
                      ) : (
                        <EditableCell
                          value={contact?.phone ?? ""}
                          placeholder="+1 (555) 555-5555"
                          disabled={!contact}
                          onSave={async (next) => {
                            if (!contact) return;
                            await saveContactPatch(fr.rowIndex, fr.contactIndex!, { phone: next || null });
                            patchContactLocal(fr.rowIndex, fr.contactIndex!, { phone: next || null });
                          }}
                          display={(v) =>
                            v ? (
                              <a
                                href={`tel:${v.replace(/\s/g, "")}`}
                                className="text-[#CEE4D4] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v}
                              </a>
                            ) : (
                              <span className="text-[#8E877A]">—</span>
                            )
                          }
                        />
                      )}
                    </Td>

                    {/* HQ Number */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <EditableCell
                          value={row.hq_phone ?? ""}
                          placeholder="+1 (555) 555-5555"
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { hq_phone: next || null });
                            patchRowLocal(fr.rowIndex, { hq_phone: next || null });
                          }}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Firmographics */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <FirmographicsInvestigateCell
                          companyId={row.company_id}
                          companyName={row.company_name}
                          firmographics={row}
                          onInvestigated={(firmographics) =>
                            patchRowLocal(fr.rowIndex, firmographics)
                          }
                        />
                      ) : null}
                    </Td>

                    {/* Agency Activity */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <AgencyActivityCell activity={row.agency_activity} />
                      ) : null}
                    </Td>

                    {/* Previous Partnerships */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <div className="space-y-1">
                          <button
                            type="button"
                            className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={bulkPartnershipResearch || researchingPipelineId != null}
                            title="Web search (last ~3 years) + Gemini; only cites URLs from search results"
                            onClick={(e) => {
                              e.stopPropagation();
                              void researchPartnershipsForRow(fr.rowIndex);
                            }}
                          >
                            {researchingPipelineId === row.pipeline_id ? "Researching…" : "Research web (3 yrs)"}
                          </button>
                          {partnershipResearchErrorByPipelineId[row.pipeline_id] ? (
                            <span className="block text-[10px] leading-snug text-[#F1A2A2]">
                              {partnershipResearchErrorByPipelineId[row.pipeline_id]}
                            </span>
                          ) : null}
                          <EditableCell
                            value={row.past_partnerships ?? ""}
                            placeholder="Known previous sponsorships / partnerships…"
                            multiline
                            minHeightPx={60}
                            disabled={bulkPartnershipResearch || researchingPipelineId === row.pipeline_id}
                            display={(v) => <PartnershipNotesDisplay text={v} />}
                            onSave={async (next) => {
                              await savePipelinePatch(fr.rowIndex, { past_partnerships: next || null });
                              patchRowLocal(fr.rowIndex, { past_partnerships: next || null });
                            }}
                          />
                        </div>
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Company Description */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <EditableCell
                          value={row.company_description ?? ""}
                          placeholder="What this company does…"
                          multiline
                          minHeightPx={60}
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { company_description: next || null });
                            patchRowLocal(fr.rowIndex, { company_description: next || null });
                          }}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Personal Notes */}
                    <Td className={yellowCell}>
                      {fr.hasContact && contact ? (
                        <EditableCell
                          value={contact.notes ?? ""}
                          placeholder="Your personal notes for this contact…"
                          multiline
                          minHeightPx={60}
                          onSave={async (next) => {
                            await saveContactPatch(fr.rowIndex, fr.contactIndex!, { notes: next || null });
                            patchContactLocal(fr.rowIndex, fr.contactIndex!, { notes: next || null });
                          }}
                        />
                      ) : !fr.hasContact ? (
                        <EditableCell
                          value={row.personal_notes ?? ""}
                          placeholder="Your personal notes…"
                          multiline
                          minHeightPx={60}
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { personal_notes: next || null });
                            patchRowLocal(fr.rowIndex, { personal_notes: next || null });
                          }}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>
                    {/* Email Subject */}
                    <Td className={yellowCell}>
                      {fr.hasContact && contact ? (
                        <EditableCell
                          value={contact.outreach_email_subject ?? row.outreach_email_subject ?? ""}
                          placeholder="Outreach subject line…"
                          onSave={async (next) => {
                            await saveContactOutreachDraft(
                              fr.rowIndex,
                              fr.contactIndex!,
                              next,
                              contact.outreach_email ?? row.outreach_email ?? ""
                            );
                          }}
                        />
                      ) : !fr.hasContact ? (
                        <EditableCell
                          value={row.outreach_email_subject ?? ""}
                          placeholder="Outreach subject line…"
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { outreach_email_subject: next || null });
                            patchRowLocal(fr.rowIndex, { outreach_email_subject: next || null });
                          }}
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>
                    {/* Outreach Email */}
                    <Td className={`${yellowCell} w-72 min-w-[18rem] max-w-[24rem]`.trim()}>
                      {fr.showCompany || fr.hasContact ? (
                        fr.hasContact && contact ? (
                          <EditableCell
                            value={contact.outreach_email ?? row.outreach_email ?? ""}
                            placeholder="Outreach email draft..."
                            multiline
                            className="block max-h-32 overflow-y-auto"
                            onSave={async (next) => {
                              await saveContactOutreachDraft(
                                fr.rowIndex,
                                fr.contactIndex!,
                                contact.outreach_email_subject ?? row.outreach_email_subject ?? "",
                                next
                              );
                            }}
                            display={(v) =>
                              v ? (
                                <pre className="whitespace-pre-wrap font-sans text-xs text-[#D7D0C4]">{v}</pre>
                              ) : (
                                <span className="text-[#8E877A]">—</span>
                              )
                            }
                          />
                        ) : !fr.hasContact ? (
                          <EditableCell
                            value={row.outreach_email ?? ""}
                            placeholder="Outreach email draft..."
                            multiline
                            className="block max-h-32 overflow-y-auto"
                            onSave={async (next) => {
                              await savePipelinePatch(fr.rowIndex, { outreach_email: next || null });
                              patchRowLocal(fr.rowIndex, { outreach_email: next || null });
                            }}
                            display={(v) =>
                              v ? (
                                <pre className="whitespace-pre-wrap font-sans text-xs text-[#D7D0C4]">{v}</pre>
                              ) : (
                                <span className="text-[#8E877A]">—</span>
                              )
                            }
                          />
                        ) : (
                          <span className="text-[#8E877A]">—</span>
                        )
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
      {isAthlete && athleteId ? (
        <TargetListAiPanel
          athleteId={athleteId}
          athleteName={athleteName}
          rows={rows ?? []}
          activeCategoryFilter={activeCategoryFilter}
          selectedCompanyIds={selectedCompanyIds}
          focusedRow={focusedRow}
          getSessionContext={getSessionContext}
          onMutatingToolsUsed={() => void refreshAfterAiMutation()}
          collapsed={aiDockCollapsed}
          onCollapsedChange={setAiDockCollapsed}
        />
      ) : isMaster ? (
        <MasterTargetListAiPanel
          rows={(rows ?? []).map((r) => ({
            pipeline_id: r.pipeline_id,
            company_id: r.company_id,
            company_name: r.company_name,
            category: r.category,
            assigned_athletes: r.assigned_athletes ?? [],
          }))}
          activeCategoryFilter={activeCategoryFilter}
          activeAthleteFilter={activeAthleteFilter}
          selectedCompanyIds={selectedCompanyIds}
          focusedRow={focusedRow}
          getSessionContext={getSessionContext}
          onMutatingToolsUsed={() => void refreshAfterAiMutation()}
          collapsed={aiDockCollapsed}
          onCollapsedChange={setAiDockCollapsed}
        />
      ) : null}
      </div>
    </div>
  );

  return (
    <CompanyRecentNewsProvider>
    <>
      {matchScoreAthletePick != null && rows?.[matchScoreAthletePick.rowIndex] ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-[#151A17] p-4 shadow-xl">
            <h4 className="text-sm font-semibold text-[#F4F1EB]">Update match score for which athlete?</h4>
            <p className="mt-1 text-xs text-[#B9B2A6]">
              Score: {formatMatchScore(matchScoreAthletePick.pendingScore) || "—"}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(rows[matchScoreAthletePick.rowIndex].assigned_athletes ?? []).map((athlete) => (
                <button
                  key={athlete.athlete_id}
                  type="button"
                  className="rounded-md border border-[#2E7040]/50 bg-[#1B2F21] px-3 py-2 text-left text-sm text-[#DBEEE0] hover:bg-[#23452E]"
                  onClick={() => {
                    const pick = matchScoreAthletePick;
                    setMatchScoreAthletePick(null);
                    void (async () => {
                      await saveMatchScore(
                        pick.rowIndex,
                        pick.pendingScore,
                        athlete.athlete_id
                      );
                      await load();
                    })();
                  }}
                >
                  {athlete.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 text-xs text-[#B9B2A6] hover:text-[#ECE7DF]"
              onClick={() => setMatchScoreAthletePick(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <ApolloRefineSearchDialog
        open={refineSearchOpen}
        prefs={apolloProspectingPrefs}
        onClose={() => setRefineSearchOpen(false)}
        onSave={updateApolloProspectingPrefs}
      />
      {focusMode && typeof document !== "undefined"
        ? createPortal(listShell, document.body)
        : listShell}
    </>
    </CompanyRecentNewsProvider>
  );
}

function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { first: trimmed, last: "" };
  return { first: trimmed.slice(0, idx).trim(), last: trimmed.slice(idx + 1).trim() };
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`whitespace-nowrap border border-white/10 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#B9B2A6] ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border border-white/10 px-2 py-1.5 align-top text-[#D7D0C4] ${className ?? ""}`}>
      {children}
    </td>
  );
}
