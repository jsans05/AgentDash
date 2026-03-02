"use client";

import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import { useState } from "react";

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text?.trim()) return { error: "Server returned an empty response." };
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `Invalid response: ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}` };
  }
}

function rowsToObjects(rows: unknown[][]): Record<string, unknown>[] {
  if (rows.length === 0) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? ""));
  return rows.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

export function ImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<"athletes" | "contracts">("athletes");
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [showContractsClearConfirm, setShowContractsClearConfirm] = useState(false);
  const [showAthletesClearConfirm, setShowAthletesClearConfirm] = useState(false);
  const [clearingContracts, setClearingContracts] = useState(false);
  const [clearingAthletes, setClearingAthletes] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview([]);
    setResult(null);

    const name = f.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (!text) return;
        const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
        setPreview((parsed.data ?? []).slice(0, 5));
      };
      reader.readAsText(f);
    } else {
      readXlsxFile(f).then((rows) => {
        setPreview(rowsToObjects(rows as unknown[][]).slice(0, 5));
      });
    }
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", importType);

    const res = await fetch("/api/admin/import", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    const data = await parseJsonResponse(res);
    setResult(data);
    setLoading(false);
  }

  async function handleClearContracts() {
    if (!showContractsClearConfirm) {
      setShowContractsClearConfirm(true);
      return;
    }
    setClearingContracts(true);
    setResult(null);
    const res = await fetch("/api/admin/contracts/clear", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      setResult({ success: true, message: `All contracts cleared. ${data.deleted ?? 0} contract(s) deleted.` });
      setShowContractsClearConfirm(false);
    } else {
      setResult({ error: data.error || "Failed to clear contracts" });
    }
    setClearingContracts(false);
  }

  async function handleClearAthletes() {
    if (!showAthletesClearConfirm) {
      setShowAthletesClearConfirm(true);
      return;
    }
    setClearingAthletes(true);
    setResult(null);
    const res = await fetch("/api/admin/athletes/clear", { method: "POST" });
    const data = await parseJsonResponse(res);
    if (data.success) {
      setResult({ success: true, message: `All athletes and related data cleared. ${data.deleted ?? 0} athlete(s) deleted.` });
      setShowAthletesClearConfirm(false);
    } else {
      setResult({ error: data.error || "Failed to clear athletes" });
    }
    setClearingAthletes(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium mb-4">Upload File</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Import Type
            </label>
            <select
              value={importType}
              onChange={(e) => setImportType(e.target.value as "athletes" | "contracts")}
              className="px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="athletes">Athletes</option>
              <option value="contracts">Contracts</option>
            </select>
          </div>
          {importType === "athletes" && (
            <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              <p className="font-medium text-gray-700 mb-1">Athletes format</p>
              <p className="mb-1">First row = headers. Supported column names (any case):</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><strong>First Name</strong>, <strong>Last Name</strong> (required)</li>
                <li><strong>Sport</strong>, <strong>Country of Origin</strong> (or Country)</li>
                <li><strong>Agent</strong> — agent email, or full name (e.g. &quot;Jane Smith&quot;) if they exist in Profiles with role Agent</li>
                <li>Optional: City, State, CreatorIQ ID, Accolades (semicolon-separated)</li>
              </ul>
            </div>
          )}
          {importType === "contracts" && (
            <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              <p className="font-medium text-gray-700 mb-1">Contracts format</p>
              <p className="mb-1">First row = headers. Multiple rows per athlete = multiple contracts. Supported columns (any case):</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li><strong>Athlete Name</strong> — full name (e.g. &quot;Griffin Colapinto&quot;) or &quot;Last, First&quot;; athlete must already exist in the roster</li>
                <li><strong>Sponsor Name</strong> (or Company Name) — sponsor company</li>
                <li><strong>Category</strong> — must match the taxonomy for the athlete&apos;s sport (Endemic or Non-Endemic); unknown values are rejected unless the sport has &quot;Unknown&quot; in taxonomy</li>
                <li><strong>Contract Start</strong>, <strong>Contract End</strong> (or Start Date, End Date)</li>
                <li><strong>Agent</strong> (optional) — links this athlete to this agent if not already linked</li>
              </ul>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              File (CSV or XLSX)
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          {preview.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Preview (first 5 rows):</p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {Object.keys(preview[0] || {}).map((key) => (
                        <th key={key} className="px-3 py-2 text-left font-medium text-gray-700">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="px-3 py-2 text-gray-500">
                            {String(val || "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <button
            onClick={handleImport}
            disabled={!file || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import"}
          </button>
        </div>
      </div>

      {result && (
        <div className={`bg-white shadow rounded-lg p-6 ${
          result.error ? "border-l-4 border-red-500" : "border-l-4 border-green-500"
        }`}>
          <h3 className="text-lg font-medium mb-2">
            {result.error ? "Error" : result.message ? "Done" : "Import Successful"}
          </h3>
          {result.error ? (
            <p className="text-red-600">{result.error}</p>
          ) : result.message ? (
            <p className="text-green-700">{result.message}</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>Rows imported: {result.imported}{result.total_rows != null ? ` of ${result.total_rows} in file` : ""}</p>
              {result.skipped_no_athlete != null && (
                <p className={result.skipped_no_athlete > 0 ? "text-amber-700" : "text-gray-600"}>
                  Skipped (athlete not found): {result.skipped_no_athlete} row(s).
                  {result.skipped_no_athlete > 0 && " Add these athletes to the roster first, or match names exactly (e.g. &quot;First Last&quot; or &quot;Last, First&quot;)."}
                </p>
              )}
              {result.skipped_no_data != null && (
                <p className={result.skipped_no_data > 0 ? "text-amber-700" : "text-gray-600"}>
                  Skipped (missing athlete or sponsor name): {result.skipped_no_data} row(s).
                </p>
              )}
              {result.imported === 0 && (result.skipped_no_athlete > 0 || result.skipped_no_data > 0) && (
                <p className="text-gray-600 mt-2">Tip: Import athletes first, then use the exact same names in the contract file.</p>
              )}
              {result.insert_error && (
                <p className="text-red-600 mt-2 font-medium">Insert error: {result.insert_error}</p>
              )}
              {result.import_errors && Array.isArray(result.import_errors) && result.import_errors.length > 0 && (
                <div className="mt-3 p-3 bg-red-50 rounded border border-red-200">
                  <p className="font-medium text-red-800">Category validation errors ({result.import_errors.length} row(s)):</p>
                  <ul className="mt-2 text-sm text-red-700 list-disc list-inside space-y-1">
                    {result.import_errors.slice(0, 20).map((err: any, i: number) => (
                      <li key={i}>Row {err.row}: {err.athleteName} / {err.sponsorName} — category &quot;{err.category}&quot;: {err.reason}</li>
                    ))}
                    {result.import_errors.length > 20 && (
                      <li>… and {result.import_errors.length - 20} more</li>
                    )}
                  </ul>
                </div>
              )}
              {result.debug && (
                <div className="text-sm mt-2 text-gray-700 space-y-1">
                  {result.debug.row_keys != null && result.debug.row_keys.length > 0 && (
                    <p>Columns in file: {result.debug.row_keys.join(", ")}</p>
                  )}
                  {result.debug.athletes_in_db != null && (
                    <p>Athletes in roster: {result.debug.athletes_in_db}</p>
                  )}
                  {result.debug.first_athlete_name != null && (
                    <p>First row: looked up &quot;{result.debug.first_athlete_name}&quot; → {result.debug.first_athlete_found ? "found" : "not found"}.</p>
                  )}
                </div>
              )}
              {result.imported === 0 && result.debug?.athletes_in_db === 0 && (
                <p className="text-amber-700 mt-2">Roster has 0 athletes. Import athletes first, then import contracts.</p>
              )}
              {result.imported === 0 && result.debug?.first_athlete_found === false && (result.debug?.athletes_in_db ?? 0) > 0 && (
                <p className="text-amber-700 mt-2">Names in your file must match roster exactly (e.g. &quot;Carey Hart&quot;). Check the column has athlete names and the roster has that athlete.</p>
              )}
              {result.imported === 0 && !result.insert_error && (result.skipped_no_athlete ?? 0) === 0 && (result.skipped_no_data ?? 0) === 0 && result.skipped_no_athlete != null && (
                <p className="text-gray-600 mt-2">No rows had both athlete name and sponsor name. Check your file has &quot;Athlete Name&quot; and &quot;Sponsor Name&quot; columns and at least one data row.</p>
              )}
              {result.created && Object.keys(result.created).length > 0 && (
                <div>
                  <p className="font-medium">Created:</p>
                  <ul className="list-disc list-inside ml-2">
                    {Object.entries(result.created).map(([key, val]: [string, any]) => (
                      <li key={key}>
                        {key}: {val}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Danger Zone: clear contracts or athletes */}
      <div className="bg-white shadow rounded-lg p-6 border-l-4 border-red-500">
        <h2 className="text-lg font-medium mb-2 text-red-700">Danger Zone</h2>
        <p className="text-sm text-gray-600 mb-4">
          Permanently delete data. These actions cannot be undone.
        </p>

        <div className="space-y-4">
          {/* Clear all contracts */}
          <div className="flex flex-wrap items-center gap-2">
            {showContractsClearConfirm && (
              <span className="text-sm text-red-700 mr-2">Click again to confirm:</span>
            )}
            <button
              onClick={handleClearContracts}
              disabled={clearingContracts}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                showContractsClearConfirm
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-red-100 text-red-700 hover:bg-red-200"
              } disabled:opacity-50`}
            >
              {clearingContracts ? "Clearing..." : showContractsClearConfirm ? "Confirm: Clear all contracts" : "Clear all contracts"}
            </button>
            {showContractsClearConfirm && (
              <button
                onClick={() => setShowContractsClearConfirm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Clear all athletes */}
          <div className="flex flex-wrap items-center gap-2">
            {showAthletesClearConfirm && (
              <span className="text-sm text-red-700 mr-2">Click again to confirm:</span>
            )}
            <button
              onClick={handleClearAthletes}
              disabled={clearingAthletes}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                showAthletesClearConfirm
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-red-100 text-red-700 hover:bg-red-200"
              } disabled:opacity-50`}
            >
              {clearingAthletes ? "Clearing..." : showAthletesClearConfirm ? "Confirm: Clear all athletes" : "Clear all athletes"}
            </button>
            {showAthletesClearConfirm && (
              <button
                onClick={() => setShowAthletesClearConfirm(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Clearing athletes also removes their contracts, CreatorIQ snapshots, and athlete–agent links.
          </p>
        </div>
      </div>
    </div>
  );
}
