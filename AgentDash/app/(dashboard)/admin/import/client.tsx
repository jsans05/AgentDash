"use client";

import Link from "next/link";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
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

type ImportProgressState = {
  percent: number;
  label: string;
};

function mapServerPercent(serverPercent: number, uploadComplete: boolean): number {
  if (!uploadComplete) {
    return Math.min(12, Math.round(serverPercent * 0.12));
  }
  return Math.min(100, 12 + Math.round(serverPercent * 0.88));
}

function importWithProgress(
  formData: FormData,
  onProgress: (progress: ImportProgressState) => void
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/import");
    xhr.withCredentials = true;

    let uploadComplete = false;
    let parsedThrough = 0;
    let lineBuffer = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const handleNdjsonChunk = (text: string) => {
      if (!text) return;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "progress" && typeof event.percent === "number") {
            onProgress({
              percent: mapServerPercent(event.percent, uploadComplete),
              label: typeof event.label === "string" ? event.label : "Importing…",
            });
          } else if (event.type === "done") {
            settle(() => resolve((event.result as Record<string, unknown>) ?? {}));
          } else if (event.type === "error") {
            settle(() =>
              reject(new Error(typeof event.error === "string" ? event.error : "Import failed"))
            );
          }
        } catch {
          // Ignore malformed lines.
        }
      }
    };

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const uploadPct = Math.round((e.loaded / e.total) * 12);
      onProgress({
        percent: uploadPct,
        label: e.loaded >= e.total ? "Processing import…" : "Uploading file…",
      });
      if (e.loaded >= e.total) uploadComplete = true;
    };

    xhr.onprogress = () => {
      const chunk = xhr.responseText.slice(parsedThrough);
      parsedThrough = xhr.responseText.length;
      handleNdjsonChunk(chunk);
    };

    xhr.onload = () => {
      const tail = xhr.responseText.slice(parsedThrough);
      if (tail) handleNdjsonChunk(tail);
      if (lineBuffer.trim()) handleNdjsonChunk("\n");

      if (settled) return;

      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => reject(new Error("Import finished without a result from the server.")));
        return;
      }

      if (!xhr.responseText.trim()) {
        settle(() => reject(new Error(`Import failed (HTTP ${xhr.status})`)));
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText) as Record<string, unknown>;
        settle(() =>
          reject(
            new Error(typeof data.error === "string" ? data.error : `Import failed (HTTP ${xhr.status})`)
          )
        );
      } catch {
        settle(() =>
          reject(new Error(xhr.responseText.slice(0, 200) || `Import failed (HTTP ${xhr.status})`))
        );
      }
    };

    xhr.onerror = () => reject(new Error("Import request failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Import cancelled."));

    xhr.send(formData);
  });
}

export function ImportClient() {
  const [file, setFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<"athletes" | "contracts" | "social_audience">("athletes");
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [result, setResult] = useState<any>(null);
  const [showContractsClearConfirm, setShowContractsClearConfirm] = useState(false);
  const [showAthletesClearConfirm, setShowAthletesClearConfirm] = useState(false);
  const [showMergeDuplicatesConfirm, setShowMergeDuplicatesConfirm] = useState(false);
  const [clearingContracts, setClearingContracts] = useState(false);
  const [clearingAthletes, setClearingAthletes] = useState(false);
  const [mergingDuplicates, setMergingDuplicates] = useState(false);
  const [rosterDiff, setRosterDiff] = useState<Record<string, unknown> | null>(null);
  const [comparingRoster, setComparingRoster] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview([]);
    setResult(null);
    setRosterDiff(null);

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
      readXlsxFile(f).then((sheets) => {
        const rows = (sheets[0]?.data ?? []) as unknown[][];
        setPreview(rowsToObjects(rows).slice(0, 5));
      });
    }
  }

  async function handleCompareRoster() {
    if (!file) return;
    setComparingRoster(true);
    setRosterDiff(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/import/roster-diff", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setRosterDiff({ error: typeof data.error === "string" ? data.error : "Compare failed" });
      } else {
        setRosterDiff(data);
      }
    } catch (e: unknown) {
      setRosterDiff({
        error: e instanceof Error ? e.message : "Compare request failed",
      });
    } finally {
      setComparingRoster(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setProgress({ percent: 0, label: "Starting import…" });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", importType);
    formData.append("stream", "1");

    try {
      const data = await importWithProgress(formData, setProgress);
      setProgress({ percent: 100, label: "Import complete" });
      setResult(data);
    } catch (e: unknown) {
      console.error("[Admin Import] Network or fetch error", e);
      setResult({
        error:
          e instanceof Error
            ? e.message
            : "Import request failed before reaching the server. Check dev server status and network.",
      });
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(null), 1200);
    }
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

  async function handleMergeDuplicateAthletes() {
    if (!showMergeDuplicatesConfirm) {
      setShowMergeDuplicatesConfirm(true);
      return;
    }
    setMergingDuplicates(true);
    setResult(null);

    try {
      const res = await fetch("/api/admin/social-audience/merge-duplicates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          deleteRules: {
            names: [{ first: "Alberto", last: "Fernandez" }],
          },
        }),
      });

      const data = await parseJsonResponse(res);
      if (res.ok) {
        const mergedCount = Array.isArray(data.merges) ? data.merges.length : 0;
        const deletedCount = Array.isArray(data.merges)
          ? data.merges.filter((m: any) => m.deleted).length
          : 0;
        setResult({
          message: `Merge complete. Groups processed: ${mergedCount}. Duplicates deleted: ${deletedCount}.`,
          data,
        });
      } else {
        setResult({ error: (data as any).error || "Failed to merge duplicates" });
      }
    } catch (e: any) {
      console.error("[Admin Import] Merge duplicates request failed", e);
      setResult({ error: e?.message || "Merge duplicates request failed" });
    } finally {
      setMergingDuplicates(false);
      setShowMergeDuplicatesConfirm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
        <h2 className="mb-4 text-lg font-medium text-[#F4F1EB]">Upload File</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
              Import Type
            </label>
            <select
              value={importType}
              onChange={(e) =>
                setImportType(e.target.value as "athletes" | "contracts" | "social_audience")
              }
              className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-[#ECE7DF]"
            >
              <option value="athletes">Athletes</option>
              <option value="contracts">Contracts</option>
              <option value="social_audience">Athlete Social &amp; Audience (Excel)</option>
            </select>
          </div>
          {importType === "athletes" && (
            <div className="rounded-md border border-white/10 bg-[#101513] p-3 text-sm text-[#D7D0C4]">
              <p className="mb-1 font-medium text-[#F4F1EB]">Athletes format</p>
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
            <div className="rounded-md border border-white/10 bg-[#101513] p-3 text-sm text-[#D7D0C4]">
              <p className="mb-1 font-medium text-[#F4F1EB]">Contracts format</p>
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
          {importType === "social_audience" && (
            <div className="rounded-md border border-white/10 bg-[#101513] p-3 text-sm text-[#D7D0C4]">
              <p className="mb-1 font-medium text-[#F4F1EB]">Athlete Social &amp; Audience format</p>
              <p className="mb-1">
                Upload a single Excel workbook (.xlsx) with sheets named{" "}
                <strong>Social Data</strong> and <strong>Audience Data</strong>. Optional:{" "}
                <strong>Talent Info</strong> (processed first).
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  <strong>Talent Info</strong> (optional): row 1 may be a category title (e.g. Action Sports);
                  header row with <strong>#</strong>, <strong>First Name</strong>, <strong>Last Name</strong>,{" "}
                  <strong>Sport</strong>, <strong>Agent</strong>, <strong>Country of Origin</strong>.{" "}
                  <strong>Properties</strong> (e.g. The Berrics) can leave <strong>Last Name</strong> blank — the full
                  name goes in First Name. Creates or updates roster entries and agent links. Multiple agents:
                  separate with <strong>/</strong> or commas.
                </li>
                <li>
                  <strong>Social Data</strong> columns (case-insensitive): Name, Total Followers, Avg. ER
                  (20P), Total Lifetime Posts, IG Followers, Avg. ER (IG, 20P), IG Lifetime Posts, TT
                  Followers, Avg. ER (TT, 20P), TT Lifetime Posts, FB Followers, Avg. ER (FB, 20P), FB
                  Lifetime Posts, X Followers, Avg. ER (X, 20P), X Lifetime Posts.
                </li>
                <li>
                  <strong>Audience Data</strong> columns (case-insensitive): Name, Last Updated, Audience
                  Category, Audience Name, % IG Audience, # IG Audience, Current IG Following.
                </li>
                <li>
                  Social and audience rows match athletes by <strong>Name</strong> (creates a minimal roster
                  entry if still not found). Review skipped rows in the import summary.
                </li>
                <li>
                  Large files are processed in bulk (roster loaded once, then batch database writes) so imports
                  finish much faster than row-by-row uploads.
                </li>
              </ul>
            </div>
          )}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
              File (CSV or XLSX)
            </label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-[#B9B2A6] file:mr-4 file:rounded-md file:border-0 file:bg-[#1B2F21] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#DBEEE0] hover:file:bg-[#23452E]"
            />
          </div>
          {preview.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-[#F4F1EB]">Preview (first 5 rows):</p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="bg-[#1A211D]">
                    <tr>
                      {Object.keys(preview[0] || {}).map((key) => (
                        <th key={key} className="px-3 py-2 text-left font-medium text-[#D7D0C4]">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-[#151A17]">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="px-3 py-2 text-[#B9B2A6]">
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
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleImport}
              disabled={!file || loading}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {loading ? "Importing..." : "Import"}
            </button>
            {importType === "social_audience" && (
              <button
                type="button"
                onClick={handleCompareRoster}
                disabled={!file || loading || comparingRoster}
                className="rounded-md border border-white/20 bg-[#101513] px-4 py-2 text-sm text-[#ECE7DF] hover:bg-[#1A211D] disabled:opacity-50"
              >
                {comparingRoster ? "Comparing…" : "Compare roster to Excel"}
              </button>
            )}
          </div>
          {(loading || progress) && (
            <div className="space-y-2 pt-2" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#D7D0C4]">{progress?.label ?? "Importing…"}</span>
                <span className="tabular-nums text-[#B9B2A6]">{progress?.percent ?? 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#101513]">
                <div
                  className="h-full rounded-full bg-[#2E7040] transition-[width] duration-300 ease-out"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
            </div>
          )}
          {rosterDiff && (
            <div
              className={`mt-4 rounded-md border p-4 text-sm ${
                rosterDiff.error
                  ? "border-[#8C3A3A]/50 bg-[#3A1E1E] text-[#F1A2A2]"
                  : "border-white/10 bg-[#101513] text-[#D7D0C4]"
              }`}
            >
              {typeof rosterDiff.error === "string" ? (
                <p>{rosterDiff.error}</p>
              ) : (
                <>
                  <p className="mb-2 font-medium text-[#F4F1EB]">Roster vs Excel</p>
                  {rosterDiff.summary && typeof rosterDiff.summary === "object" && (
                    <ul className="mb-3 list-inside list-disc space-y-0.5">
                      <li>
                        Roster: {(rosterDiff.summary as any).rosterCount} athletes · Excel (Talent Info):{" "}
                        {(rosterDiff.summary as any).excelRowsCompared} rows compared · Matched:{" "}
                        {(rosterDiff.summary as any).matchedOnRoster}
                      </li>
                      <li>
                        Only on roster (not in Excel):{" "}
                        <strong className="text-[#F4F1EB]">
                          {(rosterDiff.summary as any).onlyOnRosterCount}
                        </strong>
                      </li>
                      <li>
                        Only in Excel (not on roster):{" "}
                        <strong className="text-[#F4F1EB]">
                          {(rosterDiff.summary as any).onlyInExcelCount}
                        </strong>
                      </li>
                      {(rosterDiff.summary as any).ambiguousExcelCount > 0 && (
                        <li>
                          Ambiguous Excel names (duplicate roster matches):{" "}
                          {(rosterDiff.summary as any).ambiguousExcelCount}
                        </li>
                      )}
                    </ul>
                  )}
                  {Array.isArray(rosterDiff.onlyOnRoster) && rosterDiff.onlyOnRoster.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 font-medium text-[#F3D8A2]">On roster only</p>
                      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                        {(rosterDiff.onlyOnRoster as any[]).map((row) => (
                          <li key={row.athlete_id}>
                            <Link
                              href={row.profilePath ?? `/athlete/${row.athlete_id}`}
                              className="text-[#DBEEE0] underline hover:text-[#F4F1EB]"
                            >
                              {[row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
                                row.athlete_id}
                            </Link>
                            {row.sport ? (
                              <span className="text-[#B9B2A6]"> · {row.sport}</span>
                            ) : null}
                            {row.country ? (
                              <span className="text-[#B9B2A6]"> · {row.country}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(rosterDiff.onlyInExcel) && rosterDiff.onlyInExcel.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 font-medium text-[#F3D8A2]">In Excel only</p>
                      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                        {(rosterDiff.onlyInExcel as any[]).map((row, i) => (
                          <li key={`${row.sheet}-${row.rowIndex}-${i}`}>
                            {row.displayName}
                            <span className="text-[#B9B2A6]">
                              {" "}
                              ({row.sheet} row {row.rowIndex})
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(rosterDiff.ambiguousExcel) &&
                    rosterDiff.ambiguousExcel.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium text-[#FFD2D2]">Ambiguous in Excel</p>
                        <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-[#F1A2A2]">
                          {(rosterDiff.ambiguousExcel as any[]).map((row, i) => (
                            <li key={`${row.displayName}-${i}`}>
                              {row.displayName} (row {row.rowIndex}) — multiple roster profiles
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {Array.isArray(rosterDiff.onlyOnRoster) &&
                    rosterDiff.onlyOnRoster.length === 0 &&
                    Array.isArray(rosterDiff.onlyInExcel) &&
                    rosterDiff.onlyInExcel.length === 0 && (
                      <p className="text-[#DBEEE0]">
                        Every Talent Info row matches a roster profile, and every roster athlete appears in
                        the Excel file.
                      </p>
                    )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className={`rounded-lg border p-6 shadow ${
          result.error
            ? "border-[#8C3A3A]/50 bg-[#3A1E1E]"
            : "border-[#2E7040]/50 bg-[#1B2F21]"
        }`}>
          <h3 className="mb-2 text-lg font-medium text-[#F4F1EB]">
            {result.error ? "Error" : result.message ? "Done" : "Import Successful"}
          </h3>
          {result.error ? (
            <p className="text-[#F1A2A2]">{result.error}</p>
          ) : result.message ? (
            <p className="text-[#DBEEE0]">{result.message}</p>
          ) : (
            <div className="space-y-2 text-sm text-[#E6E0D5]">
              <p>Rows imported: {result.imported}{result.total_rows != null ? ` of ${result.total_rows} in file` : ""}</p>
              {result.skipped_no_athlete != null && (
                <p className={result.skipped_no_athlete > 0 ? "text-[#F3D8A2]" : "text-[#D7D0C4]"}>
                  Skipped (athlete not found): {result.skipped_no_athlete} row(s).
                  {result.skipped_no_athlete > 0 && " Add these athletes to the roster first, or match names exactly (e.g. &quot;First Last&quot; or &quot;Last, First&quot;)."}
                </p>
              )}
              {result.skipped_no_data != null && (
                <p className={result.skipped_no_data > 0 ? "text-[#F3D8A2]" : "text-[#D7D0C4]"}>
                  Skipped (missing athlete or sponsor name): {result.skipped_no_data} row(s).
                </p>
              )}
              {result.imported === 0 && (result.skipped_no_athlete > 0 || result.skipped_no_data > 0) && (
                <p className="mt-2 text-[#D7D0C4]">Tip: Import athletes first, then use the exact same names in the contract file.</p>
              )}
              {result.insert_error && (
                <p className="mt-2 font-medium text-[#F1A2A2]">Insert error: {result.insert_error}</p>
              )}
              {result.import_errors && Array.isArray(result.import_errors) && result.import_errors.length > 0 && (
                <div className="mt-3 rounded border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3">
                  <p className="font-medium text-[#FFD2D2]">Category validation errors ({result.import_errors.length} row(s)):</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#F1A2A2]">
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
                <div className="mt-2 space-y-1 text-sm text-[#D7D0C4]">
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
                <p className="mt-2 text-[#F3D8A2]">Roster has 0 athletes. Import athletes first, then import contracts.</p>
              )}
              {result.imported === 0 && result.debug?.first_athlete_found === false && (result.debug?.athletes_in_db ?? 0) > 0 && (
                <p className="mt-2 text-[#F3D8A2]">Names in your file must match roster exactly (e.g. &quot;Carey Hart&quot;). Check the column has athlete names and the roster has that athlete.</p>
              )}
              {result.imported === 0 && !result.insert_error && (result.skipped_no_athlete ?? 0) === 0 && (result.skipped_no_data ?? 0) === 0 && result.skipped_no_athlete != null && (
                <p className="mt-2 text-[#D7D0C4]">No rows had both athlete name and sponsor name. Check your file has &quot;Athlete Name&quot; and &quot;Sponsor Name&quot; columns and at least one data row.</p>
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
              {result.sheets && Array.isArray(result.sheets) && result.sheets.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="font-medium">By sheet:</p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    {result.sheets.map((sheet: any) => (
                      <li key={sheet.sheet}>
                        {sheet.sheet}: {sheet.inserted} inserted, {sheet.updated} updated, {sheet.skipped}{" "}
                        skipped, {sheet.failed} failed ({sheet.total} rows)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.failures && Array.isArray(result.failures) && result.failures.length > 0 && (
                <div className="mt-3 rounded border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3">
                  <p className="font-medium text-[#FFD2D2]">
                    Row issues ({result.failures.length} row(s)):
                  </p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#F1A2A2]">
                    {result.failures.slice(0, 25).map((err: any, i: number) => (
                      <li key={i}>
                        {err.sheet} row {err.rowIndex}: {err.reason}
                      </li>
                    ))}
                    {result.failures.length > 25 && (
                      <li>… and {result.failures.length - 25} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Danger Zone: clear contracts or athletes */}
      <div className="rounded-lg border border-[#8C3A3A]/50 bg-[#2B1616] p-6 shadow">
        <h2 className="mb-2 text-lg font-medium text-[#FFD2D2]">Danger Zone</h2>
        <p className="mb-4 text-sm text-[#E4C2C2]">
          Permanently delete data. These actions cannot be undone.
        </p>

        <div className="space-y-4">
          {/* Clear all contracts */}
          <div className="flex flex-wrap items-center gap-2">
            {showContractsClearConfirm && (
              <span className="mr-2 text-sm text-[#FFD2D2]">Click again to confirm:</span>
            )}
            <button
              onClick={handleClearContracts}
              disabled={clearingContracts}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                showContractsClearConfirm
                  ? "bg-[#8C3A3A] text-white hover:bg-[#A64747]"
                  : "bg-[#3A1E1E] text-[#FFD2D2] hover:bg-[#4A2525]"
              } disabled:opacity-50`}
            >
              {clearingContracts ? "Clearing..." : showContractsClearConfirm ? "Confirm: Clear all contracts" : "Clear all contracts"}
            </button>
            {showContractsClearConfirm && (
              <button
                onClick={() => setShowContractsClearConfirm(false)}
                className="rounded-md bg-[#202723] px-4 py-2 text-sm text-[#D7D0C4] hover:bg-[#28302B]"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Clear all athletes */}
          <div className="flex flex-wrap items-center gap-2">
            {showAthletesClearConfirm && (
              <span className="mr-2 text-sm text-[#FFD2D2]">Click again to confirm:</span>
            )}
            <button
              onClick={handleClearAthletes}
              disabled={clearingAthletes}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                showAthletesClearConfirm
                  ? "bg-[#8C3A3A] text-white hover:bg-[#A64747]"
                  : "bg-[#3A1E1E] text-[#FFD2D2] hover:bg-[#4A2525]"
              } disabled:opacity-50`}
            >
              {clearingAthletes ? "Clearing..." : showAthletesClearConfirm ? "Confirm: Clear all athletes" : "Clear all athletes"}
            </button>
            {showAthletesClearConfirm && (
              <button
                onClick={() => setShowAthletesClearConfirm(false)}
                className="rounded-md bg-[#202723] px-4 py-2 text-sm text-[#D7D0C4] hover:bg-[#28302B]"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-[#C8A8A8]">
            Clearing athletes also removes their contracts, CreatorIQ snapshots, and athlete–agent links.
          </p>

          {/* Merge duplicates */}
          <div className="flex flex-wrap items-center gap-2">
            {showMergeDuplicatesConfirm && (
              <span className="mr-2 text-sm text-[#FFD2D2]">Click again to confirm:</span>
            )}
            <button
              onClick={handleMergeDuplicateAthletes}
              disabled={mergingDuplicates}
              className={`px-4 py-2 rounded-md text-sm font-medium ${
                showMergeDuplicatesConfirm
                  ? "bg-[#8C3A3A] text-white hover:bg-[#A64747]"
                  : "bg-[#3A1E1E] text-[#FFD2D2] hover:bg-[#4A2525]"
              } disabled:opacity-50`}
            >
              {mergingDuplicates
                ? "Merging..."
                : showMergeDuplicatesConfirm
                ? "Confirm: Merge duplicates (social/audience)"
                : "Merge duplicates (social/audience)"}
            </button>
            {showMergeDuplicatesConfirm && (
              <button
                onClick={() => setShowMergeDuplicatesConfirm(false)}
                className="rounded-md bg-[#202723] px-4 py-2 text-sm text-[#D7D0C4] hover:bg-[#28302B]"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
