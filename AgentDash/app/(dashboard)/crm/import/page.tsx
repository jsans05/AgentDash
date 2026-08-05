"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ImportResult = {
  processed: number;
  companies: number;
  cards_created: number;
  cards_updated: number;
  contacts_inserted: number;
  contacts_updated: number;
  skipped: number;
  list_id?: string | null;
  list_name?: string | null;
  members_added?: number;
  row_errors?: string[];
  parse_errors?: string[];
};

type CrmListOption = { id: string; name: string };

const EXPECTED_HEADERS = [
  "Category",
  "Company",
  "NOTE",
  "Contact Name",
  "Role",
  "Email",
  "LinkedIn",
  "Company Website",
] as const;

type ListAction = "skip" | "new" | "existing";

export default function CrmImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [exportingTemplate, setExportingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [listAction, setListAction] = useState<ListAction>("skip");
  const [newListName, setNewListName] = useState("");
  const [existingListId, setExistingListId] = useState("");
  const [lists, setLists] = useState<CrmListOption[]>([]);

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/lists", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLists((data.lists ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  async function downloadTemplate() {
    setExportingTemplate(true);
    setError(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("CRM Import");
      ws.columns = EXPECTED_HEADERS.map((header) => ({
        header,
        width:
          header === "Company Website" || header === "LinkedIn" || header === "NOTE"
            ? 36
            : header === "Contact Name" || header === "Company"
              ? 24
              : 16,
      }));
      ws.addRow([
        "Coolers / Outdoor",
        "Example Brand",
        "Met at Summit — warm intro",
        "Jane Smith",
        "Head of Partnerships",
        "jane@example.com",
        "https://www.linkedin.com/in/example",
        "https://example.com",
      ]);
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "crm-import-template.xlsx";
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

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please select an Excel file (.xlsx).");
      return;
    }
    if (listAction === "new" && !newListName.trim()) {
      setError("Enter a name for the new list.");
      return;
    }
    if (listAction === "existing" && !existingListId) {
      setError("Select an existing list.");
      return;
    }

    setWorking(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("list_action", listAction);
      if (listAction === "new") formData.append("new_list_name", newListName.trim());
      if (listAction === "existing") formData.append("list_id", existingListId);

      const res = await fetch("/api/crm/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || res.statusText || `HTTP ${res.status}`);
        return;
      }

      setResult(data as ImportResult);
      await loadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#F4F1EB]">CRM Import</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#B9B2A6]">
              Upload brands and contacts into your Pipeline. Optionally add them to a CRM list for
              Sequence and Pipeline filtering.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/crm/lists"
              className="inline-flex h-8 items-center rounded-md border border-white/15 bg-[#1A211D] px-3 text-xs font-medium text-[#D7D0C4] hover:bg-[#243028]"
            >
              CRM Lists
            </Link>
            <Link
              href="/crm"
              className="inline-flex h-8 items-center rounded-md border border-white/15 bg-[#1A211D] px-3 text-xs font-medium text-[#D7D0C4] hover:bg-[#243028]"
            >
              Pipeline
            </Link>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        <div className="rounded-lg border border-white/10 bg-[#151A17] p-4 sm:p-5">
          <h2 className="text-sm font-medium text-[#F4F1EB]">Expected headers</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXPECTED_HEADERS.map((h) => (
              <span
                key={h}
                className="rounded border border-white/10 bg-[#121614] px-2 py-0.5 text-xs text-[#CEE4D4]"
              >
                {h}
              </span>
            ))}
          </div>
        </div>

        <form
          onSubmit={onImport}
          className="space-y-4 rounded-lg border border-white/10 bg-[#151A17] p-4 sm:p-5"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
              Excel file (.xlsx)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
              className="block w-full text-sm text-[#B9B2A6] file:mr-4 file:rounded-md file:border-0 file:bg-[#1B2F21] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#DBEEE0] hover:file:bg-[#23452E]"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[#D7D0C4]">Add to CRM list</legend>
            <label className="flex items-center gap-2 text-sm text-[#B9B2A6]">
              <input
                type="radio"
                name="list_action"
                checked={listAction === "skip"}
                onChange={() => setListAction("skip")}
              />
              Don&apos;t add to a list (Pipeline only)
            </label>
            <label className="flex items-center gap-2 text-sm text-[#B9B2A6]">
              <input
                type="radio"
                name="list_action"
                checked={listAction === "new"}
                onChange={() => setListAction("new")}
              />
              Create new list
            </label>
            {listAction === "new" ? (
              <input
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="Meta Ads"
                className="ml-6 block w-full max-w-sm rounded-md border border-white/15 bg-[#101513] px-3 py-2 text-sm text-[#F4F1EB]"
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm text-[#B9B2A6]">
              <input
                type="radio"
                name="list_action"
                checked={listAction === "existing"}
                onChange={() => setListAction("existing")}
              />
              Add to existing list (merge)
            </label>
            {listAction === "existing" ? (
              <select
                value={existingListId}
                onChange={(e) => setExistingListId(e.target.value)}
                className="ml-6 block w-full max-w-sm rounded-md border border-white/15 bg-[#101513] px-3 py-2 text-sm text-[#F4F1EB]"
              >
                <option value="">Select a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={working || !file}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-sm font-medium text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {working ? "Importing…" : "Import to Pipeline"}
            </button>
            <button
              type="button"
              disabled={exportingTemplate}
              onClick={() => void downloadTemplate()}
              className="rounded-md border border-white/20 bg-[#101513] px-4 py-2 text-sm text-[#ECE7DF] hover:bg-[#1A211D] disabled:opacity-50"
            >
              {exportingTemplate ? "Preparing…" : "Download template"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-[#E8A3A3]" role="alert">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-3 rounded-md border border-[#2E7040]/40 bg-[#1B2F21] p-4 text-sm text-[#DBEEE0]">
              <p className="font-medium text-[#F4F1EB]">Import complete</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                <li>Rows processed: {result.processed}</li>
                <li>Companies: {result.companies}</li>
                <li>Pipeline cards created: {result.cards_created}</li>
                <li>Pipeline cards updated: {result.cards_updated}</li>
                <li>Contacts inserted: {result.contacts_inserted}</li>
                <li>Contacts updated: {result.contacts_updated}</li>
                {result.list_name ? (
                  <li>
                    List: {result.list_name}
                    {result.members_added ? ` (+${result.members_added} brands)` : ""}
                  </li>
                ) : null}
              </ul>
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                {result.list_id ? (
                  <Link
                    href={`/crm/lists/${result.list_id}?name=${encodeURIComponent(result.list_name ?? "")}`}
                    className="inline-flex h-8 items-center rounded-md bg-[#2E7040] px-3 text-xs font-medium text-white hover:bg-[#285F36]"
                  >
                    Open list
                  </Link>
                ) : null}
                <Link
                  href={`/crm/sequence${result.list_id ? `?list=${encodeURIComponent(result.list_id)}` : ""}`}
                  className="inline-flex h-8 items-center rounded-md border border-white/15 bg-[#121614] px-3 text-xs font-medium text-[#D7D0C4] hover:bg-[#1A211D]"
                >
                  Open Sequence
                </Link>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
