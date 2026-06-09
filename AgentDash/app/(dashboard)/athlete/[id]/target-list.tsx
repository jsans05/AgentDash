"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ApolloRevealStatus } from "@/components/crm/ApolloContactActions";
import { ContactEmailCell } from "@/components/crm/ContactEmailCell";
import { ApolloFindContactsInline, type ApolloContactSearchOverrides } from "@/components/crm/ApolloFindContactsInline";
import { ApolloTargetListProspecting } from "@/components/crm/ApolloTargetListProspecting";
import {
  loadApolloRevenueFilterPrefs,
  parseRevenueFilterBody,
} from "@/lib/apollo/prospecting-prefs";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { PartnershipNotesDisplay } from "@/components/crm/PartnershipNotesDisplay";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { TargetListCompanyContactActions } from "@/components/crm/TargetListCompanyContactActions";
import { formatApolloPartnershipSearchSummary } from "@/lib/apollo/search-defaults";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY,
  TARGET_LIST_FIND_CONTACTS_DISMISS_KEY,
  TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";
import {
  isDeletableTargetListContact,
  mapApiContactToTargetList,
  mergeCompanyContactsIntoRows,
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
import { sortTargetListRows } from "@/lib/crm/athlete-target-list";
import { upsertContactOutreachDraft } from "@/lib/crm/target-list-outreach";

type Contact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: ApolloRevealStatus;
  outreach_email_subject: string | null;
  outreach_email: string | null;
  email_drafts?: unknown;
};

type TargetListRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  match_score: number | null;
  website: string | null;
  hq_phone: string | null;
  company_description: string | null;
  past_partnerships: string | null;
  personal_notes: string | null;
  outreach_email_subject: string | null;
  outreach_email: string | null;
  contacts: Contact[];
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

function buildFlatRows(rows: TargetListRow[]): FlatRow[] {
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

const COLUMNS = [
  "Category",
  "Company",
  "Company Website",
  "Match Score",
  "Contact Name",
  "Role",
  "Email",
  "LinkedIn",
  "Number",
  "HQ Number",
  "Previous Partnerships",
  "Company Description",
  "Personal Notes",
  "Email Subject",
  "Outreach Email",
] as const;

export function AthleteTargetList({
  athleteId,
  athleteName,
}: {
  athleteId: string;
  athleteName?: string;
}) {
  const [rows, setRows] = useState<TargetListRow[] | null>(null);
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
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [generatingOutreachKey, setGeneratingOutreachKey] = useState<string | null>(null);
  const [searchDisclosureHtml, setSearchDisclosureHtml] = useState<string | null>(null);
  const [searchDisclosureCompany, setSearchDisclosureCompany] = useState<string | null>(null);
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [bulkFindConfirmOpen, setBulkFindConfirmOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ pipelineId: string; companyName: string } | null>(
    null
  );
  const [removingPipelineId, setRemovingPipelineId] = useState<string | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [deletingContactsCompanyId, setDeletingContactsCompanyId] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{
    companyId: string;
    contactIds: string[];
    mode: "unrevealed" | "selected";
  } | null>(null);
  const [apolloSearchOverrides, setApolloSearchOverrides] = useState<ApolloContactSearchOverrides>({});

  useEffect(() => {
    setApolloSearchOverrides(parseRevenueFilterBody(loadApolloRevenueFilterPrefs()));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/target-list`, {
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
  }, [athleteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flat = useMemo(() => (rows ? buildFlatRows(rows) : []), [rows]);

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
  function patchContactLocal(rowIndex: number, contactIndex: number, patch: Partial<Contact>) {
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

  function applyCompanyContactsToRows(companyId: string, apiContacts: unknown[]) {
    const contacts = (Array.isArray(apiContacts) ? apiContacts : []).map((c) =>
      mapApiContactToTargetList(c as Record<string, unknown>)
    );
    setRows((prev) =>
      prev ? (mergeCompanyContactsIntoRows(prev, companyId, contacts) as TargetListRow[]) : prev
    );
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
    mode: "unrevealed" | "selected"
  ) {
    if (contactIds.length === 0) return;
    if (isTargetListDialogDismissed(TARGET_LIST_DELETE_CONTACTS_BULK_DISMISS_KEY)) {
      void bulkDeleteContacts(companyId, contactIds);
      return;
    }
    setBulkDeleteConfirm({ companyId, contactIds, mode });
  }

  async function bulkDeleteContacts(companyId: string, contactIds: string[]) {
    if (contactIds.length === 0) return;
    setDeletingContactsCompanyId(companyId);
    setGlobalError(null);
    try {
      const res = await fetch("/api/crm/contacts/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contact_ids: contactIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      const deleted: string[] = Array.isArray(data.deleted) ? data.deleted.map(String) : [];
      if (deleted.length === 0) throw new Error("No contacts were deleted");
      removeContactsLocal(deleted);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingContactsCompanyId(null);
    }
  }

  async function saveMatchScore(rowIndex: number, nextScore: number | null) {
    const row = rows?.[rowIndex];
    if (!row) return;
    const res = await fetch(`/api/crm/pipeline/${row.pipeline_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        athlete_id: athleteId,
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

    // Link the new contact to the athlete so it shows up in outreach flows.
    try {
      await fetch(`/api/crm/contacts/${data.contact.contact_id}/athletes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ athlete_ids: [athleteId] }),
      });
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

  async function removeCompanyFromTargetList(pipelineId: string) {
    setRemovingPipelineId(pipelineId);
    setGlobalError(null);
    try {
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

  function requestRemoveCompany(pipelineId: string, companyName: string) {
    if (isTargetListDialogDismissed(TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY)) {
      void removeCompanyFromTargetList(pipelineId);
      return;
    }
    setRemoveConfirm({ pipelineId, companyName });
  }

  async function findContactsForAllCompanies() {
    if (!rows || rows.length === 0) return;
    setBulkFindContacts(true);
    setGlobalError(null);
    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    try {
      const body: Record<string, unknown> = { company_ids: companyIds };
      if (apolloSearchOverrides.organization_locations?.length) {
        body.organization_locations = apolloSearchOverrides.organization_locations;
      }
      if (apolloSearchOverrides.revenue_range) {
        body.revenue_range = apolloSearchOverrides.revenue_range;
      }
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
          applyCompanyContactsToRows(String(result.company_id), result.contacts ?? []);
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
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "AgentDash";
      wb.created = new Date();
      const ws = wb.addWorksheet("Target List", {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      ws.columns = [
        { header: "Category", width: 26 },
        { header: "Company", width: 28 },
        { header: "Company Website", width: 32 },
        { header: "Match Score", width: 12 },
        { header: "Contact Name", width: 24 },
        { header: "Role", width: 26 },
        { header: "Email", width: 28 },
        { header: "LinkedIn", width: 12 },
        { header: "Number", width: 16 },
        { header: "HQ Number", width: 16 },
        { header: "Previous Partnerships", width: 36 },
        { header: "Company Description", width: 48 },
        { header: "Personal Notes", width: 36 },
        { header: "Email Subject", width: 40 },
        { header: "Outreach Email", width: 56 },
      ];

      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "left" };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE8E8E8" },
      };
      headerRow.border = {
        bottom: { style: "thin", color: { argb: "FF999999" } },
      };

      const YELLOW_ARGB = "FFFFF3B0";

      let prevCategoryKey: string | null = null;
      let prevCompanyId: string | null = null;

      for (const row of rows) {
        const categoryKey = (row.category ?? UNCATEGORIZED_LABEL).toLowerCase();
        const contacts = row.contacts.length > 0 ? row.contacts : [null];

        contacts.forEach((c, idx) => {
          const showCategory = categoryKey !== prevCategoryKey && idx === 0;
          const showCompany = row.company_id !== prevCompanyId;
          const yellow = c == null;

          const contactName = c ? formatContactDisplayName(c.first_name, c.last_name) : "";

          const excelRow = ws.addRow([
            showCategory ? row.category ?? UNCATEGORIZED_LABEL : "",
            showCompany ? row.company_name : "",
            showCompany ? row.website ?? "" : "",
            showCompany && row.match_score != null ? row.match_score : "",
            contactName,
            c?.role ?? "",
            c?.apollo_reveal_status === "pending" ? "" : c?.email ?? "",
            c?.linkedin_url && safeHttpUrl(c.linkedin_url) ? c.linkedin_url : "",
            c?.phone ?? "",
            showCompany ? row.hq_phone ?? "" : "",
            showCompany ? row.past_partnerships ?? "" : "",
            showCompany ? row.company_description ?? "" : "",
            c?.notes ?? (showCompany ? row.personal_notes ?? "" : ""),
            c?.outreach_email_subject ?? (showCompany ? row.outreach_email_subject ?? "" : ""),
            c?.outreach_email ?? (showCompany ? row.outreach_email ?? "" : ""),
          ]);

          excelRow.alignment = { vertical: "top", wrapText: true };

          if (yellow) {
            // Highlight all "yellow" columns (everything except Category) per spec.
            for (let col = 2; col <= COLUMNS.length; col++) {
              excelRow.getCell(col).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: YELLOW_ARGB },
              };
            }
          }

          if (showCategory) {
            excelRow.getCell(1).font = { bold: true };
          }
          if (showCompany) {
            excelRow.getCell(2).font = { bold: true };
          }

          prevCategoryKey = categoryKey;
          prevCompanyId = row.company_id;
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (athleteName ?? "athlete").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "athlete";
      a.href = url;
      a.download = `${safeName}-target-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Failed to export Excel");
    } finally {
      setExporting(false);
    }
  }

  function applyGeneratedOutreach(
    generated: Array<{
      pipeline_id?: string;
      contact_id?: string;
      outreach_email_subject?: string;
      outreach_email?: string;
    }>
  ) {
    if (!rows || generated.length === 0) return;
    setRows((prev) => {
      if (!prev) return prev;
      return prev.map((row) => {
        const forRow = generated.filter((g) => g.pipeline_id === row.pipeline_id);
        if (forRow.length === 0) return row;

        let nextRow = { ...row };
        for (const g of forRow) {
          const subject = g.outreach_email_subject ?? null;
          const body = g.outreach_email ?? null;
          if (g.contact_id) {
            nextRow = {
              ...nextRow,
              contacts: nextRow.contacts.map((c) => {
                if (c.contact_id !== g.contact_id) return c;
                const email_drafts = upsertContactOutreachDraft(
                  c.email_drafts,
                  athleteId,
                  subject ?? "",
                  body ?? ""
                );
                return {
                  ...c,
                  email_drafts,
                  outreach_email_subject: subject,
                  outreach_email: body,
                };
              }),
            };
          } else {
            nextRow = {
              ...nextRow,
              outreach_email_subject: subject ?? nextRow.outreach_email_subject,
              outreach_email: body ?? nextRow.outreach_email,
            };
          }
        }
        return nextRow;
      });
    });
  }

  async function saveContactOutreachDraft(
    rowIndex: number,
    contactIndex: number,
    subject: string,
    body: string
  ) {
    const contact = rows?.[rowIndex]?.contacts[contactIndex];
    if (!contact) return;
    const email_drafts = upsertContactOutreachDraft(
      contact.email_drafts,
      athleteId,
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

  function outreachGenerateKey(rowIndex: number, contactIndex: number | null) {
    const row = rows?.[rowIndex];
    if (!row) return "";
    const contactId =
      contactIndex != null ? row.contacts[contactIndex]?.contact_id ?? "none" : "company";
    return `${row.pipeline_id}:${contactId}`;
  }

  function recipientNameForContact(rowIndex: number, contactIndex: number | null): string {
    const row = rows?.[rowIndex];
    if (!row || contactIndex == null) return "[Recipient Name]";
    const c = row.contacts[contactIndex];
    if (!c) return "[Recipient Name]";
    const first = c.first_name?.trim();
    if (first) return first;
    return formatContactDisplayName(c.first_name, c.last_name) || "[Recipient Name]";
  }

  async function handleGenerateOutreachForRow(rowIndex: number, contactIndex: number | null) {
    const row = rows?.[rowIndex];
    if (!row) return;
    const genKey = outreachGenerateKey(rowIndex, contactIndex);
    setGeneratingOutreachKey(genKey);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/target-list/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          pipeline_id: row.pipeline_id,
          contact_id:
            contactIndex != null ? row.contacts[contactIndex]?.contact_id ?? undefined : undefined,
          recipient_name: recipientNameForContact(rowIndex, contactIndex),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate outreach email");
      }
      const firstError = Array.isArray(data.errors) ? data.errors[0] : null;
      if (firstError?.error) {
        throw new Error(`${firstError.company_name || row.company_name}: ${firstError.error}`);
      }
      if ((data.updated ?? 0) === 0) {
        throw new Error("No outreach email was generated for this company");
      }
      applyGeneratedOutreach(Array.isArray(data.generated) ? data.generated : []);
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Failed to generate outreach email");
    } finally {
      setGeneratingOutreachKey(null);
    }
  }

  async function handleGenerateOutreachEmails() {
    if (!rows || rows.length === 0) return;
    setGeneratingOutreach(true);
    setGlobalError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/target-list/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate outreach emails");
      }
      applyGeneratedOutreach(Array.isArray(data.generated) ? data.generated : []);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const first = data.errors[0];
        setGlobalError(
          `Generated ${data.updated ?? 0}/${data.processed ?? 0} emails. ${first.company_name || "Company"}: ${first.error}`
        );
      }
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : "Failed to generate outreach emails");
    } finally {
      setGeneratingOutreach(false);
    }
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

  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17]">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-[#F4F1EB]">Target List</h3>
          <p className="mt-0.5 text-xs text-[#B9B2A6]">
            Every company prospected and assigned to this athlete in your CRM pipeline. Click any cell to edit in place;
            changes sync to the CRM. Rows without a contact are highlighted.
          </p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto">
          {rows && rows.length > 0 ? (
            <ApolloTargetListProspecting
              athleteId={athleteId}
              selectedCompanyIds={[...selectedCompanyIds]}
              disabled={bulkFindContacts || bulkPartnershipResearch || researchingPipelineId != null || loading}
              onError={(msg) => setGlobalError(msg)}
              onPrefsChange={(p) => setApolloSearchOverrides(parseRevenueFilterBody(p))}
            />
          ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {rows && rows.length > 0 ? (
            <span className="whitespace-nowrap text-xs text-[#B9B2A6]">
              {rows.length} {rows.length === 1 ? "company" : "companies"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => requestBulkFindContacts()}
            disabled={
              bulkFindContacts ||
              bulkPartnershipResearch ||
              researchingPipelineId != null ||
              generatingOutreach ||
              loading ||
              !rows ||
              rows.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
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
            onClick={() => void researchPartnershipsForAllCompanies()}
            disabled={
              bulkFindContacts ||
              bulkPartnershipResearch ||
              researchingPipelineId != null ||
              generatingOutreach ||
              loading ||
              !rows ||
              rows.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
            title="Web search + Gemini for each company; bullets cite search result URLs only"
          >
            {bulkPartnershipResearch
              ? `Researching ${bulkPartnershipIndex}/${rows?.length ?? 0}…`
              : "Research partnerships (all)"}
          </button>
          <button
            type="button"
            onClick={() => void handleGenerateOutreachEmails()}
            disabled={
              generatingOutreach ||
              generatingOutreachKey != null ||
              bulkFindContacts ||
              bulkPartnershipResearch ||
              researchingPipelineId != null ||
              loading ||
              !rows ||
              rows.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2E7040]/60 bg-[#173522] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#1F4730] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generatingOutreach ? "Generating…" : "Generate Outreach Emails"}
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={
              exporting ||
              bulkFindContacts ||
              bulkPartnershipResearch ||
              researchingPipelineId != null ||
              loading ||
              !rows ||
              rows.length === 0
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
        </div>
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
            <>
              <p>
                <span className="font-medium text-[#E6E0D5]">{removeConfirm.companyName}</span> will be
                removed from this athlete&apos;s target list.
              </p>
              <p className="text-[#AEA79A]">
                The company stays in your CRM pipeline. You can add it back later from the CRM.
              </p>
            </>
          ) : null
        }
        confirmLabel="Remove"
        dismissStorageKey={TARGET_LIST_REMOVE_COMPANY_DISMISS_KEY}
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          const target = removeConfirm;
          setRemoveConfirm(null);
          if (target) void removeCompanyFromTargetList(target.pipelineId);
        }}
      />

      <TargetListActionDialog
        open={bulkDeleteConfirm != null}
        title={
          bulkDeleteConfirm?.mode === "unrevealed"
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
            bulkDeleteConfirm.mode === "unrevealed" ? (
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

      {loading ? (
        <div className="p-4 text-sm text-[#B9B2A6]">Loading target list…</div>
      ) : error ? (
        <div className="p-4 text-sm text-[#F1A2A2]">{error}</div>
      ) : !rows || rows.length === 0 ? (
        <div className="p-4 text-sm text-[#B9B2A6]">
          No target companies yet. Open <Link href="/crm" className="text-[#CEE4D4] underline hover:text-[#E8F6ED]">the CRM</Link> and assign this
          athlete on a pipeline card to populate this list.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-[#1A211D] text-[#D7D0C4]">
              <tr>
                {COLUMNS.map((c) => (
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
                  <tr key={fr.key} className="border-t border-white/10 align-top hover:bg-white/[0.03]">
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
                          <label className="flex items-center gap-1.5 text-[10px] text-[#AEA79A]">
                            <input
                              type="checkbox"
                              className="rounded border-white/20"
                              checked={selectedCompanyIds.has(row.company_id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                setSelectedCompanyIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(row.company_id);
                                  else next.delete(row.company_id);
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            Select for expand
                          </label>
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
                          <ApolloFindContactsInline
                            companyId={row.company_id}
                            companyName={row.company_name}
                            searchOverrides={apolloSearchOverrides}
                            disabled={bulkFindContacts || removingPipelineId === row.pipeline_id}
                            onContacts={(contacts) => applyCompanyContactsToRows(row.company_id, contacts)}
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
                              requestRemoveCompany(row.pipeline_id, row.company_name);
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
                            await saveMatchScore(fr.rowIndex, parsed);
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
                        {contact && isDeletableTargetListContact(contact) ? (
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
                      <ContactLinkedinCell linkedinUrl={contact?.linkedin_url} />
                    </Td>

                    {/* Number */}
                    <Td className={yellowCell}>
                      <EditableCell
                        value={contact?.phone ?? ""}
                        placeholder="+1 (555) 555-5555"
                        disabled={!contact}
                        onSave={async (next) => {
                          if (!contact) return;
                          await saveContactPatch(fr.rowIndex, fr.contactIndex!, { phone: next || null });
                          patchContactLocal(fr.rowIndex, fr.contactIndex!, { phone: next || null });
                        }}
                      />
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
                          value={contact.outreach_email_subject ?? ""}
                          placeholder="Outreach subject line…"
                          onSave={async (next) => {
                            await saveContactOutreachDraft(
                              fr.rowIndex,
                              fr.contactIndex!,
                              next,
                              contact.outreach_email ?? ""
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
                        <div className="space-y-1">
                          <button
                            type="button"
                            className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={
                              generatingOutreach ||
                              generatingOutreachKey === outreachGenerateKey(fr.rowIndex, fr.contactIndex) ||
                              bulkFindContacts ||
                              bulkPartnershipResearch
                            }
                            title={
                              fr.hasContact
                                ? `Generate outreach email addressed to ${recipientNameForContact(fr.rowIndex, fr.contactIndex)}`
                                : "Generate athlete-to-company outreach email from template"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleGenerateOutreachForRow(fr.rowIndex, fr.contactIndex);
                            }}
                          >
                            {generatingOutreachKey === outreachGenerateKey(fr.rowIndex, fr.contactIndex)
                              ? "Generating…"
                              : "Generate"}
                          </button>
                          {fr.hasContact && contact ? (
                            <EditableCell
                              value={contact.outreach_email ?? ""}
                              placeholder="Generated outreach email draft..."
                              multiline
                              className="block max-h-32 overflow-y-auto"
                              onSave={async (next) => {
                                await saveContactOutreachDraft(
                                  fr.rowIndex,
                                  fr.contactIndex!,
                                  contact.outreach_email_subject ?? "",
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
                              placeholder="Generated outreach email draft..."
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
                          )}
                        </div>
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
    </section>
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
