"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, Maximize2, Minimize2 } from "lucide-react";
import { ContactEmailCell } from "@/components/crm/ContactEmailCell";
import { ContactPhoneCell } from "@/components/crm/ContactPhoneCell";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { ApolloFindContactsInline } from "@/components/crm/ApolloFindContactsInline";
import { ApolloRefineSearchDialog } from "@/components/crm/ApolloRefineSearchDialog";
import { ConsultingTargetListAiPanel } from "@/components/crm/ConsultingTargetListAiDock";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { EditableCell } from "@/components/crm/target-list/EditableCell";
import {
  buildFlatRows,
  splitName,
  Th,
  Td,
  UNCATEGORIZED_LABEL,
} from "@/components/crm/target-list/TableChrome";
import { contactSearchOverridesToRequestBody } from "@/lib/apollo/contact-search-api-body";
import {
  loadApolloRevenueFilterPrefs,
  parseRevenueFilterBody,
  saveApolloRevenueFilterPrefs,
  type ApolloRevenueFilterPrefs,
} from "@/lib/apollo/prospecting-prefs";
import type { ApolloContactSearchOverrides } from "@/lib/apollo/search-defaults";
import { formatApolloPartnershipSearchSummary } from "@/lib/apollo/search-defaults";
import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import { buildConsultingTargetListSessionContext } from "@/lib/crm/consulting-target-list-session-context";
import { CONSULTING_TARGET_LIST_COLUMNS } from "@/lib/crm/target-list-column-config";
import { exportTargetListToExcel } from "@/lib/crm/target-list-export";
import { FirmographicsInvestigateCell } from "@/components/crm/FirmographicsInvestigateCell";
import { AgencyActivityCell } from "@/components/crm/AgencyActivityCell";
import {
  readStoredTargetListPanelCollapsed,
  readStoredTargetListFocusMode,
  writeStoredTargetListFocusMode,
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
} from "@/lib/crm/target-list-chat-constants";
import type { TargetListFocusedRow } from "@/lib/crm/target-list-session-context";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_FIND_CONTACTS_DISMISS_KEY,
  TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import {
  mapApiContactToTargetList,
  mergeCompanyContactsIntoRows,
  patchContactInRows,
  removeContactFromRows,
} from "@/lib/crm/target-list-contacts";
import type { TargetListContact, TargetListRow } from "@/lib/crm/athlete-target-list";
import { safeHttpUrl } from "@/lib/security/url";
import { cn } from "@/lib/utils";

type Props = {
  profileId: string;
  profileName: string;
};

export function ConsultingTargetList({ profileId, profileName }: Props) {
  const [rows, setRows] = useState<TargetListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bulkFindContacts, setBulkFindContacts] = useState(false);
  const [bulkFindConfirmOpen, setBulkFindConfirmOpen] = useState(false);
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ entryId: string; companyName: string } | null>(
    null
  );
  const [expandingCompanyId, setExpandingCompanyId] = useState<string | null>(null);
  const [expandSummary, setExpandSummary] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addWebsite, setAddWebsite] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [apolloProspectingPrefs, setApolloProspectingPrefs] = useState<ApolloRevenueFilterPrefs>({});
  const [apolloSearchOverrides, setApolloSearchOverrides] = useState<ApolloContactSearchOverrides>({});
  const [refineSearchOpen, setRefineSearchOpen] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState(TARGET_LIST_CATEGORY_FILTER_ALL);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [focusedRow, setFocusedRow] = useState<TargetListFocusedRow | null>(null);
  const [aiDockCollapsed, setAiDockCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [navOffsetPx, setNavOffsetPx] = useState(64);
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

  const bulkActionBtnClass =
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50";

  const bulkActionsDisabled = bulkFindContacts || loading || rows.length === 0;

  const setFocusModePersisted = useCallback((next: boolean) => {
    setFocusMode(next);
    writeStoredTargetListFocusMode(next);
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/consulting/profiles/${profileId}/target-list`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load target list");
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setAiDockCollapsed(readStoredTargetListPanelCollapsed());
    const prefs = loadApolloRevenueFilterPrefs();
    setApolloProspectingPrefs(prefs);
    setApolloSearchOverrides(parseRevenueFilterBody(prefs));
    setFocusMode(readStoredTargetListFocusMode());
    const nav = document.querySelector("header");
    if (nav) setNavOffsetPx(nav.getBoundingClientRect().height);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && focusMode) setFocusModePersisted(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiDockCollapsed((c) => !c);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, setFocusModePersisted]);

  useEffect(() => {
    if (!bulkActionsOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!bulkActionsRef.current?.contains(e.target as Node)) setBulkActionsOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [bulkActionsOpen]);

  const categorySummary = useMemo(() => {
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
      sorted: [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      uncategorized,
      total: rows.length,
    };
  }, [rows]);

  const visibleRowIndexes = useMemo(() => {
    const indexes = new Set<number>();
    rows.forEach((r, i) => {
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
  }, [rows, activeCategoryFilter]);

  const flat = useMemo(() => {
    return buildFlatRows(rows).filter((fr) => visibleRowIndexes.has(fr.rowIndex));
  }, [rows, visibleRowIndexes]);

  const getSessionContext = useCallback(() => {
    return buildConsultingTargetListSessionContext({
      consultingProfileId: profileId,
      profileName,
      activeCategoryFilter,
      rows: rows.map((r) => ({
        pipeline_id: r.pipeline_id,
        company_id: r.company_id,
        company_name: r.company_name,
        category: r.category,
        contacts: r.contacts.map((c) => ({
          contact_id: c.contact_id,
          first_name: c.first_name,
          last_name: c.last_name,
        })),
      })),
      selectedCompanyIds,
      focusedRow,
    });
  }, [profileId, profileName, activeCategoryFilter, rows, selectedCompanyIds, focusedRow]);

  function patchRowLocal(rowIndex: number, patch: Partial<TargetListRow>) {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)));
  }

  function patchContactLocal(rowIndex: number, contactIndex: number, patch: Partial<TargetListContact>) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex) return r;
        const contacts = [...r.contacts];
        contacts[contactIndex] = { ...contacts[contactIndex]!, ...patch };
        return { ...r, contacts };
      })
    );
  }

  function focusFlatRow(fr: ReturnType<typeof buildFlatRows>[number]) {
    const row = rows[fr.rowIndex];
    if (!row) return;
    const contact = fr.contactIndex != null ? row.contacts[fr.contactIndex] : null;
    setFocusedRow({
      pipelineId: row.pipeline_id,
      companyId: row.company_id,
      companyName: row.company_name,
      category: row.category,
      contactId: contact?.contact_id ?? null,
      contactName: contact
        ? formatContactDisplayName(contact.first_name, contact.last_name)
        : null,
      rowIndex: fr.rowIndex,
      contactIndex: fr.contactIndex,
    });
  }

  function toggleCompanySelected(companyId: string, checked: boolean) {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(companyId);
      else next.delete(companyId);
      return next;
    });
  }

  async function patchEntry(entryId: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/consulting/profiles/${profileId}/target-list/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Update failed");
  }

  async function saveContactPatch(rowIndex: number, contactIndex: number, patch: Record<string, unknown>) {
    const contact = rows[rowIndex]?.contacts[contactIndex];
    if (!contact) return;
    const res = await fetch(`/api/crm/contacts/${contact.contact_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Save failed");
  }

  async function createContactForRow(rowIndex: number, patch: Record<string, string>) {
    const row = rows[rowIndex];
    if (!row) return;
    const payload = {
      first_name: patch.first_name ?? "",
      last_name: patch.last_name ?? "",
      company_name: row.company_name,
      consulting_profile_id: profileId,
      role: patch.role ?? null,
      email: patch.email ?? null,
      phone: patch.phone ?? null,
      linkedin_url: patch.linkedin_url ?? null,
    };
    if (!payload.first_name || !payload.last_name) throw new Error("First and last name required");
    const res = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Create failed");
    const mapped = mapApiContactToTargetList(data.contact);
    setRows((prev) => mergeCompanyContactsIntoRows(prev, row.company_id, [mapped]));
  }

  function applyCompanyContactsToRows(
    companyId: string,
    contacts: unknown[],
    meta?: { hq_phone?: string | null }
  ) {
    const mapped = contacts.map((c) => mapApiContactToTargetList(c as Record<string, unknown>));
    setRows((prev) => {
      let next = mergeCompanyContactsIntoRows(prev, companyId, mapped);
      if (meta?.hq_phone) {
        next = next.map((r) => (r.company_id === companyId ? { ...r, hq_phone: meta.hq_phone! } : r));
      }
      return next;
    });
  }

  async function removeEntry(entryId: string) {
    setRemovingEntryId(entryId);
    try {
      const res = await fetch(`/api/consulting/profiles/${profileId}/target-list`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entry_id: entryId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setRows((prev) => prev.filter((r) => r.pipeline_id !== entryId));
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemovingEntryId(null);
    }
  }

  function requestRemove(entryId: string, companyName: string) {
    if (isTargetListDialogDismissed(TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY)) {
      void removeEntry(entryId);
      return;
    }
    setRemoveConfirm({ entryId, companyName });
  }

  async function findSimilarForRow(row: TargetListRow) {
    const category = row.category?.trim();
    if (!category || isEffectivelyUncategorizedCompanyCategory(category)) {
      setGlobalError("Set an industry category on this row before finding similar companies.");
      return;
    }
    setExpandingCompanyId(row.company_id);
    setExpandSummary(null);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/consulting/profiles/${profileId}/expand-similar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          seed_company_ids: [row.company_id],
          industry_category: category,
          add_to_target_list: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Find similar failed");
      const added = data.summary?.added ?? 0;
      const total = data.summary?.total_similar ?? 0;
      setExpandSummary(`Added ${added} of ${total} similar companies for ${row.company_name}.`);
      await loadRows();
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Find similar failed");
    } finally {
      setExpandingCompanyId(null);
    }
  }

  async function findContactsForAllCompanies() {
    if (rows.length === 0) return;
    setBulkFindContacts(true);
    setGlobalError(null);
    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    try {
      const body: Record<string, unknown> = {
        company_ids: companyIds,
        consulting_profile_id: profileId,
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

  function requestBulkFindContacts() {
    if (isTargetListDialogDismissed(TARGET_LIST_FIND_CONTACTS_DISMISS_KEY)) {
      void findContactsForAllCompanies();
      return;
    }
    setBulkFindConfirmOpen(true);
  }

  async function handleExport() {
    if (rows.length === 0) return;
    setExporting(true);
    setGlobalError(null);
    try {
      await exportTargetListToExcel({
        columns: CONSULTING_TARGET_LIST_COLUMNS,
        rows,
        sheetName: "Consulting Target List",
        fileName: `${profileName.replace(/\s+/g, "-")}-consulting-target-list.xlsx`,
      });
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function addCompany() {
    if (!addName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/consulting/profiles/${profileId}/target-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          company_name: addName.trim(),
          website: addWebsite.trim() || null,
          industry_category: addCategory.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Add failed");
      await loadRows();
      setAddName("");
      setAddWebsite("");
      setAddCategory("");
      setShowAddForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAdding(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/consulting/profiles/${profileId}/target-list/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportSummary(
        `${data.companies_upserted ?? 0} companies · ${data.contacts_inserted ?? 0} contacts added`
      );
      await loadRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadTemplate() {
    setExportingTemplate(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Consulting Target List");
      ws.columns = [
        { header: "Industry Category", width: 22 },
        { header: "Brand", width: 24 },
        { header: "Website", width: 28 },
        { header: "HQ Phone", width: 16 },
        { header: "Contact", width: 22 },
        { header: "Title", width: 22 },
        { header: "Email", width: 28 },
      ];
      ws.addRow(["Apparel – Moto", "Example Brand", "example.com", "555-0100", "Jane Smith", "Head of Partnerships", "jane@example.com"]);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "consulting-target-list-template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download template");
    } finally {
      setExportingTemplate(false);
    }
  }

  const listShell = (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-[#151A17]",
        focusMode
          ? "fixed inset-x-0 bottom-0 z-40 border-t border-white/10 shadow-2xl"
          : "min-h-[calc(100vh-8rem)] flex-1 rounded-lg border border-white/10"
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
              <h3 className="truncate text-sm font-semibold text-[#F4F1EB]">
                {profileName} — Target List
              </h3>
              <span className="shrink-0 text-xs text-[#8E877A]">{rows.length} companies</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setAiDockCollapsed((c) => !c)}
                className={cn(bulkActionBtnClass, "border-[#2E7040]/60 bg-[#173522] text-[#DBEEE0]")}
              >
                {aiDockCollapsed ? "Open AI" : "AI open"}
              </button>
              <button
                type="button"
                onClick={() => setFocusModePersisted(false)}
                className={cn(bulkActionBtnClass, "border-white/15 bg-[#1A211D] text-[#D7D0C4]")}
              >
                <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                Exit focus
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <Link
                href={`/consulting/${profileId}?name=${encodeURIComponent(profileName)}`}
                className="text-xs text-[#B9B2A6] hover:text-[#F4F1EB]"
              >
                ← {profileName}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-[#F4F1EB]">Target List</h3>
                <button
                  type="button"
                  onClick={() => setFocusModePersisted(true)}
                  className={cn(bulkActionBtnClass, "border-white/15 bg-[#1A211D] text-[#D7D0C4]")}
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  Expand
                </button>
              </div>
              <p className="mt-0.5 text-xs text-[#B9B2A6]">
                Shared consulting prospect list. Click any cell to edit; Find contacts uses Apollo.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className={cn(bulkActionBtnClass, "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]")}
              >
                Add company
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className={cn(bulkActionBtnClass, "border-white/15 bg-[#1A211D] text-[#D7D0C4]")}
              >
                {importing ? "Importing…" : "Import Excel"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                }}
              />
              <button
                type="button"
                disabled={exportingTemplate}
                onClick={() => void downloadTemplate()}
                className={cn(bulkActionBtnClass, "border-white/15 bg-[#1A211D] text-[#D7D0C4]")}
              >
                Template
              </button>
              <button
                type="button"
                onClick={() => setAiDockCollapsed((c) => !c)}
                className={cn(bulkActionBtnClass, "border-[#2E7040]/60 bg-[#173522] text-[#DBEEE0]")}
              >
                {aiDockCollapsed ? (
                  <>
                    Open AI <ChevronLeft className="h-3.5 w-3.5" />
                  </>
                ) : (
                  "AI open"
                )}
              </button>
              <button
                type="button"
                onClick={requestBulkFindContacts}
                disabled={bulkActionsDisabled}
                className={cn(bulkActionBtnClass, "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]")}
              >
                {bulkFindContacts ? "Finding…" : "Find contacts (all)"}
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={bulkActionsDisabled || exporting}
                className={cn(bulkActionBtnClass, "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0]")}
              >
                {exporting ? "Exporting…" : "Export Excel"}
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
            <p>Run Apollo contact search for every company on this list ({rows.length} companies).</p>
            <p>{formatApolloPartnershipSearchSummary()}</p>
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
            <p>
              <span className="font-medium text-[#E6E0D5]">{removeConfirm.companyName}</span> will be
              removed from this consulting target list.
            </p>
          ) : null
        }
        confirmLabel="Remove"
        dismissStorageKey={TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY}
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          const target = removeConfirm;
          setRemoveConfirm(null);
          if (target) void removeEntry(target.entryId);
        }}
      />

      <ApolloRefineSearchDialog
        open={refineSearchOpen}
        prefs={apolloProspectingPrefs}
        onClose={() => setRefineSearchOpen(false)}
        onSave={(nextPrefs) => {
          setApolloProspectingPrefs(nextPrefs);
          setApolloSearchOverrides(parseRevenueFilterBody(nextPrefs));
          saveApolloRevenueFilterPrefs(nextPrefs);
          setRefineSearchOpen(false);
        }}
      />

      {(globalError || error) && (
        <div className="border-b border-[#8C3A3A]/50 bg-[#3A1E1E] px-4 py-2 text-xs text-[#F1A2A2]">
          {globalError || error}
        </div>
      )}
      {importSummary && (
        <div className="border-b border-[#2E7040]/40 bg-[#1B2F21] px-4 py-2 text-xs text-[#DBEEE0]">
          {importSummary}
        </div>
      )}
      {expandSummary && (
        <div className="border-b border-[#2E7040]/40 bg-[#1B2F21] px-4 py-2 text-xs text-[#DBEEE0]">
          {expandSummary}
        </div>
      )}

      {showAddForm && !focusMode ? (
        <div className="border-b border-white/10 bg-[#121614] px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Company name"
              className="rounded border border-white/15 bg-[#0B0E0D] px-2 py-1.5 text-sm text-[#F4F1EB]"
            />
            <input
              value={addWebsite}
              onChange={(e) => setAddWebsite(e.target.value)}
              placeholder="Website"
              className="rounded border border-white/15 bg-[#0B0E0D] px-2 py-1.5 text-sm text-[#F4F1EB]"
            />
            <input
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
              placeholder="Industry category"
              className="rounded border border-white/15 bg-[#0B0E0D] px-2 py-1.5 text-sm text-[#F4F1EB]"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={adding || !addName.trim()}
              onClick={() => void addCompany()}
              className="rounded bg-[#2E7040] px-3 py-1 text-xs text-[#F2FFF5] disabled:opacity-50"
            >
              {adding ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded border border-white/15 px-3 py-1 text-xs text-[#B9B2A6]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/10 px-4 py-2">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[#8E877A]">
            Category
          </span>
          <button
            type="button"
            onClick={() => setActiveCategoryFilter(TARGET_LIST_CATEGORY_FILTER_ALL)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
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
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
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
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                activeCategoryFilter === cat
                  ? "bg-[#2E7040] text-[#F2FFF5]"
                  : "border border-white/10 text-[#B9B2A6] hover:bg-white/5"
              )}
            >
              {cat} ({count})
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-[#B9B2A6]">Loading target list…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-[#B9B2A6]">No companies on this target list yet.</div>
          ) : flat.length === 0 ? (
            <div className="p-4 text-sm text-[#B9B2A6]">No companies match this category filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[#1A211D] text-[#D7D0C4]">
                  <tr>
                    {CONSULTING_TARGET_LIST_COLUMNS.map((c) => (
                      <Th key={c}>{c}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flat.map((fr) => {
                    const row = rows[fr.rowIndex]!;
                    const contact = fr.contactIndex != null ? row.contacts[fr.contactIndex] : null;
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
                            "ring-1 ring-inset ring-[#2E7040]/50 bg-[#2E7040]/5"
                        )}
                        onClick={(e) => {
                          const t = e.target as HTMLElement;
                          if (t.closest("button, a, input, textarea, select, label")) return;
                          focusFlatRow(fr);
                        }}
                      >
                        <Td>
                          {fr.showCategory ? (
                            <EditableCell
                              value={row.category}
                              placeholder="Category"
                              onSave={async (next) => {
                                await patchEntry(row.pipeline_id, {
                                  industry_category: next || null,
                                });
                                patchRowLocal(fr.rowIndex, { category: next || null });
                              }}
                              display={(v) => (
                                <span className="font-medium text-[#F4F1EB]">
                                  {v || UNCATEGORIZED_LABEL}
                                </span>
                              )}
                            />
                          ) : null}
                        </Td>
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
                                      await patchEntry(row.pipeline_id, { company_name: next });
                                      patchRowLocal(fr.rowIndex, { company_name: next });
                                    }}
                                    display={(v) => (
                                      <span className="font-medium text-[#CEE4D4]">{v || "—"}</span>
                                    )}
                                  />
                                </span>
                              </label>
                              <ApolloFindContactsInline
                                companyId={row.company_id}
                                companyName={row.company_name}
                                consultingProfileId={profileId}
                                searchOverrides={apolloSearchOverrides}
                                onRefineSearchClick={() => setRefineSearchOpen(true)}
                                disabled={bulkFindContacts || removingEntryId === row.pipeline_id}
                                onContacts={(contacts, meta) =>
                                  applyCompanyContactsToRows(row.company_id, contacts, meta)
                                }
                                onError={(msg) => setGlobalError(msg)}
                              />
                              <button
                                type="button"
                                className="block w-full rounded border border-[#21384A]/60 bg-[#1A2830] px-1.5 py-0.5 text-[10px] font-medium text-[#D7ECFF] hover:bg-[#21384A]/40 disabled:opacity-50"
                                disabled={
                                  expandingCompanyId === row.company_id ||
                                  bulkFindContacts ||
                                  removingEntryId === row.pipeline_id
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void findSimilarForRow(row);
                                }}
                              >
                                {expandingCompanyId === row.company_id
                                  ? "Finding similar…"
                                  : "Find similar"}
                              </button>
                              <button
                                type="button"
                                className="block w-full rounded border border-[#8C3A3A]/50 bg-[#2A1818] px-1.5 py-0.5 text-[10px] font-medium text-[#F1A2A2] hover:bg-[#3A1E1E] disabled:opacity-50"
                                disabled={removingEntryId === row.pipeline_id || bulkFindContacts}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestRemove(row.pipeline_id, row.company_name);
                                }}
                              >
                                {removingEntryId === row.pipeline_id ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          {fr.showCompany ? (
                            <EditableCell
                              value={row.website ?? ""}
                              placeholder="https://…"
                              onSave={async (next) => {
                                await patchEntry(row.pipeline_id, { company_website: next || null });
                                patchRowLocal(fr.rowIndex, { website: next || null });
                              }}
                              display={(v) => {
                                if (!v) return <span className="text-[#8E877A]">—</span>;
                                const safeUrl = safeHttpUrl(v);
                                if (!safeUrl) return <span className="break-all">{v}</span>;
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
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          <EditableCell
                            value={fullName}
                            placeholder="First Last"
                            onSave={async (next) => {
                              const { first, last } = splitName(next);
                              if (!first || !last) throw new Error("Enter first and last name");
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
                                <span className="text-[#CEE4D4]">{v || "—"}</span>
                              ) : (
                                <span className="italic text-[#AEA79A]">
                                  {v || "No contact — click to add"}
                                </span>
                              )
                            }
                          />
                        </Td>
                        <Td className={yellowCell}>
                          {contact ? (
                            <EditableCell
                              value={contact.role ?? ""}
                              placeholder="Role"
                              onSave={async (next) => {
                                await saveContactPatch(fr.rowIndex, fr.contactIndex!, {
                                  role: next || null,
                                });
                                patchContactLocal(fr.rowIndex, fr.contactIndex!, {
                                  role: next || null,
                                });
                              }}
                            />
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          {contact?.contact_id ? (
                            <ContactEmailCell
                              contactId={contact.contact_id}
                              email={contact.email}
                              apolloRevealStatus={contact.apollo_reveal_status}
                              onRevealed={(updated) => {
                                setRows((prev) =>
                                  patchContactInRows(prev, contact.contact_id, {
                                    email: String(updated.email ?? contact.email ?? ""),
                                    apollo_reveal_status:
                                      updated.apollo_reveal_status === "revealed"
                                        ? "revealed"
                                        : contact.apollo_reveal_status,
                                  })
                                );
                              }}
                              onDeleted={() => {
                                setRows((prev) => removeContactFromRows(prev, contact.contact_id));
                              }}
                            />
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          <ContactLinkedinCell linkedinUrl={contact?.linkedin_url} />
                        </Td>
                        <Td className={yellowCell}>
                          {contact?.contact_id ? (
                            <ContactPhoneCell
                              contactId={contact.contact_id}
                              phone={contact.phone}
                              apolloPersonId={contact.apollo_person_id}
                              apolloPhoneRevealStatus={contact.apollo_phone_reveal_status}
                              onRevealed={(updated) => {
                                setRows((prev) =>
                                  patchContactInRows(prev, contact.contact_id, {
                                    phone: String(updated.phone ?? contact.phone ?? ""),
                                    apollo_phone_reveal_status:
                                      updated.apollo_phone_reveal_status === "revealed"
                                        ? "revealed"
                                        : contact.apollo_phone_reveal_status,
                                  })
                                );
                              }}
                            />
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          {fr.showCompany ? (
                            <EditableCell
                              value={row.hq_phone ?? ""}
                              placeholder="HQ phone"
                              onSave={async (next) => {
                                await patchEntry(row.pipeline_id, { hq_phone: next || null });
                                patchRowLocal(fr.rowIndex, { hq_phone: next || null });
                              }}
                            />
                          ) : null}
                        </Td>
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
                        <Td className={yellowCell}>
                          {fr.showCompany ? (
                            <AgencyActivityCell activity={row.agency_activity} />
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          {fr.showCompany ? (
                            <EditableCell
                              value={row.company_description ?? ""}
                              placeholder="Company description…"
                              multiline
                              onSave={async (next) => {
                                await patchEntry(row.pipeline_id, {
                                  company_description: next || null,
                                });
                                patchRowLocal(fr.rowIndex, {
                                  company_description: next || null,
                                });
                              }}
                            />
                          ) : null}
                        </Td>
                        <Td className={yellowCell}>
                          {fr.showCompany ? (
                            <EditableCell
                              value={row.personal_notes ?? ""}
                              placeholder="Personal notes…"
                              multiline
                              onSave={async (next) => {
                                await patchEntry(row.pipeline_id, { personal_notes: next || null });
                                patchRowLocal(fr.rowIndex, { personal_notes: next || null });
                              }}
                            />
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <ConsultingTargetListAiPanel
          consultingProfileId={profileId}
          profileName={profileName}
          rows={rows}
          activeCategoryFilter={activeCategoryFilter}
          selectedCompanyIds={selectedCompanyIds}
          focusedRow={focusedRow}
          getSessionContext={getSessionContext}
          onMutatingToolsUsed={() => void loadRows()}
          collapsed={aiDockCollapsed}
          onCollapsedChange={setAiDockCollapsed}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      {focusMode && typeof document !== "undefined"
        ? createPortal(listShell, document.body)
        : listShell}
    </div>
  );
}
