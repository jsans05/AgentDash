"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CrmImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Please select an Excel file (.xlsx).");
      return;
    }

    setWorking(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
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

      setResult(data);
      // Go back to list so they can see new contacts immediately.
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Import CRM Excel</h1>
          <p className="mt-2 text-sm text-gray-600">
            Expected headers: `First`, `Last`, `Email/ Linkedin`, `Company`, `Role`, `Category`, `Zoominfo`, `Notes`, `Last Outreach`.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/crm")}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
        >
          Back to CRM
        </button>
      </div>

      <form onSubmit={onImport} className="bg-white shadow rounded-lg p-4 space-y-4">
        <label className="block text-sm text-gray-700">
          Excel file (.xlsx)
          <input
            className="mt-1 block w-full text-sm"
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="submit"
          disabled={working}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {working ? "Importing..." : "Import"}
        </button>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {result && (
          <div className="text-sm text-gray-700 space-y-2">
            <div>Imported: {result.processed}</div>
            {typeof result.inserted === "number" && <div>Inserted: {result.inserted}</div>}
            {typeof result.updated === "number" && <div>Updated: {result.updated}</div>}
            {typeof result.skipped === "number" && <div>Skipped: {result.skipped}</div>}
          </div>
        )}
      </form>
    </div>
  );
}

