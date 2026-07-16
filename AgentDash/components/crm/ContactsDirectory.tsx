"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ContactEmailCell } from "@/components/crm/ContactEmailCell";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { ContactPhoneCell } from "@/components/crm/ContactPhoneCell";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { Button } from "@/components/ui/button";
import { batchDeleteCrmContacts } from "@/lib/crm/batch-delete-contacts";
import {
  buildContactsListApiUrl,
  CONTACT_CATEGORY_FILTER_UNCATEGORIZED,
  hasActiveContactFilters,
  parseContactsListQuery,
  contactsListQueryToSearchParams,
  type ContactsListQuery,
} from "@/lib/crm/contacts-list-query";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import {
  CONTACT_STATUS_OPTIONS,
  contactCategoryLabel,
  EMPTY_CONTACT_FILTERS,
  HAS_FIELD_FILTER_OPTIONS,
  type ContactFilterOptions,
  type ContactFilters,
  type ContactRow,
  type ContactSortDir,
  type ContactSortKey,
  type HasFieldFilter,
} from "@/lib/crm/contact-filter-sort";
import { exportContactsToExcel } from "@/lib/crm/contact-list-export";
import { mapContactApiRow } from "@/lib/crm/map-contact-api-row";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]";

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  sticky,
}: {
  label: string;
  sortKey: ContactSortKey;
  activeSortKey: ContactSortKey;
  sortDir: ContactSortDir;
  onSort: (key: ContactSortKey) => void;
  sticky?: boolean;
}) {
  const active = activeSortKey === sortKey;
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <th
      className={cn(
        "px-2 py-2 text-left font-medium",
        sticky && "sticky left-0 z-20 bg-[#1A211D]"
      )}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-left hover:text-[#F4F1EB]",
          active ? "text-[#F4F1EB]" : "text-[#B9B2A6]"
        )}
      >
        {label}
        {active ? <span className="text-[10px] text-[#8E877A]">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function patchListQuery(
  current: ContactsListQuery,
  patch: Partial<ContactsListQuery> & { filters?: Partial<ContactFilters> }
): ContactsListQuery {
  return {
    ...current,
    ...patch,
    filters: patch.filters ? { ...current.filters, ...patch.filters } : current.filters,
  };
}

export function ContactsDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const listQuery = useMemo(() => parseContactsListQuery(searchParams), [searchParams]);

  const [searchInput, setSearchInput] = useState(listQuery.q);
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<ContactFilterOptions>({
    companies: [],
    categories: [],
    roles: [],
    statuses: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const selectedCount = selectedIds.size;
  const { filters, showArchived, sort: sortKey, dir: sortDir, page, limit } = listQuery;

  useEffect(() => {
    setSearchInput(listQuery.q);
  }, [listQuery.q]);

  const replaceQuery = useCallback(
    (next: ContactsListQuery) => {
      const params = contactsListQueryToSearchParams(next);
      const qs = params.toString();
      router.replace(qs ? `/crm/contacts?${qs}` : "/crm/contacts", { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput.trim() === listQuery.q) return;
      replaceQuery(patchListQuery(listQuery, { q: searchInput.trim(), page: 1 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, listQuery, replaceQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildContactsListApiUrl(listQuery), { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load contacts");
      const contacts = Array.isArray(data.contacts) ? data.contacts : [];
      setRows(contacts.map((c: Record<string, unknown>) => mapContactApiRow(c)));
      setTotal(typeof data.total === "number" ? data.total : contacts.length);
      if (data.filter_options) {
        setFilterOptions(data.filter_options as ContactFilterOptions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [listQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.contact_id)),
    [rows, selectedIds]
  );

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.contact_id));
  const hasFilters = hasActiveContactFilters(filters) || Boolean(listQuery.q);
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1;
  const rangeEnd = Math.min(page * limit, total);

  function patchContact(contactId: string, patch: Partial<ContactRow>) {
    setRows((prev) => prev.map((row) => (row.contact_id === contactId ? { ...row, ...patch } : row)));
  }

  function handleSort(nextKey: ContactSortKey) {
    const nextDir: ContactSortDir =
      sortKey === nextKey ? (sortDir === "asc" ? "desc" : "asc") : nextKey === "last_outreach" ? "desc" : "asc";
    replaceQuery(patchListQuery(listQuery, { sort: nextKey, dir: nextDir, page: 1 }));
  }

  function updateFilter<K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) {
    replaceQuery(
      patchListQuery(listQuery, {
        filters: { ...listQuery.filters, [key]: value },
        page: 1,
      })
    );
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(contactId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(rows.map((row) => row.contact_id)));
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const row of rows) next.delete(row.contact_id);
        return next;
      });
      return;
    }
    selectAllVisible();
  }

  async function handleExportSelected() {
    if (selectedRows.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      await exportContactsToExcel({
        rows: selectedRows,
        fileName: `contacts-${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export Excel");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const deleted = await batchDeleteCrmContacts([...selectedIds]);
      setRows((prev) => prev.filter((row) => !deleted.includes(row.contact_id)));
      setTotal((prev) => Math.max(0, prev - deleted.length));
      setSelectedIds(new Set());
      if (deleted.length > 0) setSelectionMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete contacts");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function updateContactStatus(contactId: string, status_tag: ContactRow["status_tag"]) {
    setStatusUpdatingId(contactId);
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "set_status_tag", status_tag }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update status");
      const updated = data.contact as Record<string, unknown> | undefined;
      patchContact(contactId, {
        status_tag,
        archived: status_tag === "red_bounced" ? true : Boolean(updated?.archived),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function toggleArchive(contactId: string, archived: boolean) {
    setStatusUpdatingId(contactId);
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update archive");
      patchContact(contactId, { archived });
      if (!showArchived && archived) {
        setRows((prev) => prev.filter((row) => row.contact_id !== contactId));
        setTotal((prev) => Math.max(0, prev - 1));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update archive");
    } finally {
      setStatusUpdatingId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-white/10 bg-[#141916] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, email, or company…"
            aria-label="Search contacts"
            className="min-w-[14rem] flex-1 rounded-md border border-white/15 bg-[#101513] px-3 py-1.5 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          />
          <label className="inline-flex items-center gap-2 text-sm text-[#D7D0C4]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) =>
                replaceQuery(patchListQuery(listQuery, { showArchived: e.target.checked, page: 1 }))
              }
              className="rounded border-white/20 bg-[#101513]"
            />
            Show archived
          </label>
          <Link
            href="/crm/contacts/new"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add contact
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mr-1 text-[#B9B2A6]">Filter</span>
          <select
            aria-label="Filter by company"
            className={cn(SELECT_CLASS, "min-w-[10rem]")}
            value={filters.companyName}
            onChange={(e) => updateFilter("companyName", e.target.value)}
          >
            <option value="">All companies</option>
            {filterOptions.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by category"
            className={cn(SELECT_CLASS, "min-w-[10rem]")}
            value={filters.category}
            onChange={(e) => updateFilter("category", e.target.value)}
          >
            <option value="">All categories</option>
            <option value={CONTACT_CATEGORY_FILTER_UNCATEGORIZED}>Uncategorized</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by role"
            className={cn(SELECT_CLASS, "min-w-[10rem]")}
            value={filters.role}
            onChange={(e) => updateFilter("role", e.target.value)}
          >
            <option value="">All roles</option>
            {filterOptions.roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by contact status"
            className={cn(SELECT_CLASS, "min-w-[12rem]")}
            value={filters.status_tag}
            onChange={(e) => updateFilter("status_tag", e.target.value)}
          >
            <option value="">All statuses</option>
            {CONTACT_STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by email"
            className={SELECT_CLASS}
            value={filters.hasEmail}
            onChange={(e) => updateFilter("hasEmail", e.target.value as HasFieldFilter)}
          >
            {HAS_FIELD_FILTER_OPTIONS.map((option) => (
              <option key={`email-${option.value}`} value={option.value}>
                Email: {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by phone"
            className={SELECT_CLASS}
            value={filters.hasPhone}
            onChange={(e) => updateFilter("hasPhone", e.target.value as HasFieldFilter)}
          >
            {HAS_FIELD_FILTER_OPTIONS.map((option) => (
              <option key={`phone-${option.value}`} value={option.value}>
                Phone: {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by LinkedIn"
            className={SELECT_CLASS}
            value={filters.hasLinkedin}
            onChange={(e) => updateFilter("hasLinkedin", e.target.value as HasFieldFilter)}
          >
            {HAS_FIELD_FILTER_OPTIONS.map((option) => (
              <option key={`linkedin-${option.value}`} value={option.value}>
                LinkedIn: {option.label}
              </option>
            ))}
          </select>
          {hasActiveContactFilters(filters) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
              onClick={() => replaceQuery(patchListQuery(listQuery, { filters: EMPTY_CONTACT_FILTERS, page: 1 }))}
            >
              Clear filters
            </Button>
          ) : null}
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

        {selectionMode && selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2E7040]/40 bg-[#1A2A20] px-3 py-2 text-sm">
            <span className="font-medium text-[#A7E0B6]">
              {selectedCount} selected
              {exporting ? " · exporting…" : ""}
              {deleting ? " · deleting…" : ""}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={exporting || deleting}
              onClick={() => void handleExportSelected()}
            >
              {exporting ? "Exporting…" : "Export to Excel"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              disabled={exporting || deleting}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete selected
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
              disabled={exporting || deleting}
              onClick={selectAllVisible}
            >
              Select all on page ({rows.length})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-[#D7D0C4] hover:bg-white/5 hover:text-[#F4F1EB]"
              disabled={exporting || deleting}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#8E877A]">
          <p>
            {loading
              ? "Loading contacts…"
              : total === 0
                ? "No contacts"
                : `${rangeStart}–${rangeEnd} of ${total} contact${total === 1 ? "" : "s"}`}
            {listQuery.q ? ` matching “${listQuery.q}”` : ""}
          </p>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1 || loading}
                onClick={() => replaceQuery(patchListQuery(listQuery, { page: page - 1 }))}
              >
                Previous
              </Button>
              <span>
                Page {page} of {pageCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= pageCount || loading}
                onClick={() => replaceQuery(patchListQuery(listQuery, { page: page + 1 }))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error ? <p className="mb-3 text-sm text-[#F1A2A2]">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-[#B9B2A6]">Loading contacts…</p>
        ) : rows.length === 0 ? (
          <div className="space-y-3 text-sm text-[#B9B2A6]">
            <p>{hasFilters ? "No contacts match your search and filters." : "No contacts yet."}</p>
            <div className="flex flex-wrap gap-2">
              {hasFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    replaceQuery(
                      patchListQuery(listQuery, {
                        q: "",
                        filters: EMPTY_CONTACT_FILTERS,
                        page: 1,
                      })
                    )
                  }
                >
                  Clear search & filters
                </Button>
              ) : null}
              <Link
                href="/crm/contacts/new"
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add contact
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-xs">
              <thead className="bg-[#1A211D]">
                <tr>
                  {selectionMode ? (
                    <th className="w-10 px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all contacts on this page"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="rounded border-white/20 bg-[#101513]"
                      />
                    </th>
                  ) : null}
                  <SortableHeader
                    label="Name"
                    sortKey="name"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    sticky
                  />
                  <SortableHeader
                    label="Company"
                    sortKey="company"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Category"
                    sortKey="category"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Role"
                    sortKey="role"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Email"
                    sortKey="email"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Phone"
                    sortKey="phone"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="LinkedIn"
                    sortKey="linkedin"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Last outreach"
                    sortKey="last_outreach"
                    activeSortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <th className="px-2 py-2 text-left font-medium text-[#B9B2A6]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = formatContactDisplayName(row.first_name, row.last_name);
                  const isApollo =
                    row.apollo_reveal_status === "pending" || row.apollo_reveal_status === "revealed";
                  const outreachLabel = row.last_outreach_at
                    ? new Date(row.last_outreach_at).toLocaleDateString()
                    : "—";
                  const busy = statusUpdatingId === row.contact_id;

                  return (
                    <tr
                      key={row.contact_id}
                      className={cn(
                        "border-t border-white/10",
                        row.archived && "opacity-60",
                        selectionMode && selectedIds.has(row.contact_id) && "bg-[#1A2A20]/40"
                      )}
                    >
                      {selectionMode ? (
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${name || "contact"}`}
                            checked={selectedIds.has(row.contact_id)}
                            onChange={() => toggleSelected(row.contact_id)}
                            className="rounded border-white/20 bg-[#101513]"
                          />
                        </td>
                      ) : null}
                      <td className="sticky left-0 z-10 bg-[#0F1311] px-2 py-2 text-[#ECE7DF]">
                        <Link
                          href={`/crm/contacts/${row.contact_id}`}
                          className="font-medium text-[#CEE4D4] hover:underline"
                        >
                          {name || "—"}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-[#D7D0C4]">{row.company_name}</td>
                      <td className="px-2 py-2 text-[#D7D0C4]">{contactCategoryLabel(row.category)}</td>
                      <td className="px-2 py-2 text-[#D7D0C4]">{row.role || "—"}</td>
                      <td className="px-2 py-2">
                        {isApollo ? (
                          <ContactEmailCell
                            contactId={row.contact_id}
                            email={row.email}
                            apolloRevealStatus={row.apollo_reveal_status}
                            hideDelete
                            onRevealed={(updated) => {
                              patchContact(row.contact_id, {
                                email: (updated.email as string) ?? row.email,
                                linkedin_url: (updated.linkedin_url as string) ?? row.linkedin_url,
                                apollo_reveal_status: "revealed",
                                first_name: (updated.first_name as string) ?? row.first_name,
                                last_name: (updated.last_name as string) ?? row.last_name,
                                role: (updated.role as string) ?? row.role,
                              });
                            }}
                            onDeleted={() => {
                              setRows((prev) => prev.filter((item) => item.contact_id !== row.contact_id));
                              setTotal((prev) => Math.max(0, prev - 1));
                            }}
                          />
                        ) : row.email ? (
                          <a href={`mailto:${row.email}`} className="text-[#CEE4D4] hover:underline">
                            {row.email}
                          </a>
                        ) : (
                          <span className="text-[#8E877A]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <ContactPhoneCell
                          contactId={row.contact_id}
                          phone={row.phone}
                          apolloPersonId={row.apollo_person_id}
                          apolloPhoneRevealStatus={row.apollo_phone_reveal_status}
                          email={row.email}
                          linkedinUrl={row.linkedin_url}
                          firstName={row.first_name}
                          lastName={row.last_name}
                          compact
                          onRevealed={(updated) => {
                            patchContact(row.contact_id, {
                              phone: (updated.phone as string) ?? row.phone,
                              apollo_phone_reveal_status:
                                (updated.apollo_phone_reveal_status as ContactRow["apollo_phone_reveal_status"]) ??
                                "pending",
                              apollo_person_id:
                                (updated.apollo_person_id as string) ?? row.apollo_person_id,
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <ContactLinkedinCell
                          contactId={row.contact_id}
                          linkedinUrl={row.linkedin_url}
                          email={row.email}
                          firstName={row.first_name}
                          lastName={row.last_name}
                          apolloPersonId={row.apollo_person_id}
                          compact
                          onRevealed={(updated) => {
                            patchContact(row.contact_id, {
                              linkedin_url: (updated.linkedin_url as string) ?? row.linkedin_url,
                              apollo_person_id:
                                (updated.apollo_person_id as string) ?? row.apollo_person_id,
                              apollo_reveal_status: "revealed",
                              email: (updated.email as string) ?? row.email,
                            });
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label={`Status for ${name || "contact"}`}
                          className={cn(SELECT_CLASS, "max-w-[11rem] text-xs")}
                          value={row.status_tag}
                          disabled={busy}
                          onChange={(e) =>
                            void updateContactStatus(
                              row.contact_id,
                              e.target.value as ContactRow["status_tag"]
                            )
                          }
                        >
                          {CONTACT_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-[#D7D0C4]">{outreachLabel}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleArchive(row.contact_id, !row.archived)}
                          className="text-[#CEE4D4] hover:underline disabled:opacity-50"
                        >
                          {row.archived ? "Unarchive" : "Archive"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TargetListActionDialog
        open={deleteDialogOpen}
        title="Delete selected contacts?"
        description={
          <>
            This will permanently delete {selectedCount} contact{selectedCount === 1 ? "" : "s"}. This cannot be
            undone.
          </>
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        variant="danger"
        dismissStorageKey="crm-contacts-batch-delete"
        onConfirm={() => void handleDeleteSelected()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
