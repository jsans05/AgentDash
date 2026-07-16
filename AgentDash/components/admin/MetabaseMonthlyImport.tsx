"use client";

import { Fragment, useMemo, useState } from "react";
import type {
  MetabaseImportPreview,
  MetabaseUpdateColumn,
  MetabaseWillUpdate,
} from "@/lib/import/metabase-preview";

type CreateDecision = "approve" | "deny";
type DownloadKind = "roster" | "social" | "audience";
type ColumnDenyMap = Record<string, Partial<Record<MetabaseUpdateColumn, boolean>>>;
type NameRemapMap = Record<string, string>;

const FILE_INPUT_CLASS =
  "block w-full text-sm text-[#B9B2A6] file:mr-4 file:rounded-md file:border-0 file:bg-[#1B2F21] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#DBEEE0] hover:file:bg-[#23452E]";

export function classifyMetabaseDownloadName(fileName: string): DownloadKind | null {
  const normalized = fileName.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized.includes("audience")) return "audience";
  if (normalized.includes("owned_social") || normalized.includes("social")) return "social";
  if (normalized.includes("roster") || normalized.includes("talent_roster")) return "roster";
  return null;
}

function formatMetric(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return String(n);
}

function sportCell(u: MetabaseWillUpdate): string {
  if (!u.sport_will_change) {
    const incomingBlank = !u.sport_incoming?.trim();
    if (incomingBlank) {
      return `${u.sport_current ?? "—"} → (no change)`;
    }
    return `${u.sport_current ?? "—"} → ${u.sport_incoming} (same)`;
  }
  return `${u.sport_current ?? "—"} → ${u.sport_incoming ?? "—"}`;
}

function socialDiffSummary(u: MetabaseWillUpdate): string {
  if (!u.has_social) return "—";
  if (!u.social_diff) return "yes";
  const parts: string[] = [];
  const { total_followers, ig_followers, avg_er_20p } = u.social_diff;
  if (
    total_followers.current !== total_followers.incoming ||
    total_followers.incoming != null
  ) {
    parts.push(
      `Followers ${formatMetric(total_followers.current)} → ${formatMetric(total_followers.incoming)}`
    );
  }
  if (ig_followers.current !== ig_followers.incoming || ig_followers.incoming != null) {
    parts.push(
      `IG ${formatMetric(ig_followers.current)} → ${formatMetric(ig_followers.incoming)}`
    );
  }
  if (avg_er_20p.current !== avg_er_20p.incoming || avg_er_20p.incoming != null) {
    parts.push(
      `ER ${formatMetric(avg_er_20p.current)} → ${formatMetric(avg_er_20p.incoming)}`
    );
  }
  return parts.length ? parts.join(" · ") : "yes";
}

function audienceDiffSummary(u: MetabaseWillUpdate): string {
  if (!u.has_audience) return "—";
  if (!u.audience_diff) return String(u.audience_row_count);
  return `${u.audience_diff.current_row_count} → ${u.audience_diff.incoming_row_count} rows`;
}

export function MetabaseMonthlyImport() {
  const [rosterFile, setRosterFile] = useState<File | null>(null);
  const [socialFile, setSocialFile] = useState<File | null>(null);
  const [audienceFile, setAudienceFile] = useState<File | null>(null);
  const [fileSortMessage, setFileSortMessage] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<MetabaseImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  /** create_key → decision; default deny (opt-in) */
  const [decisions, setDecisions] = useState<Record<string, CreateDecision>>({});
  /** athlete_id → denied columns */
  const [columnDenies, setColumnDenies] = useState<ColumnDenyMap>({});
  /** create_key → athlete_id remap */
  const [nameRemaps, setNameRemaps] = useState<NameRemapMap>({});
  const [expandedDupes, setExpandedDupes] = useState<Record<string, boolean>>({});
  const [remapFilter, setRemapFilter] = useState<Record<string, string>>({});

  const hasAnyFile = Boolean(rosterFile || socialFile || audienceFile);

  const remappedCreateKeys = useMemo(
    () => new Set(Object.keys(nameRemaps).filter((k) => nameRemaps[k])),
    [nameRemaps]
  );

  const approvedCount = useMemo(
    () =>
      Object.entries(decisions).filter(
        ([key, d]) => d === "approve" && !remappedCreateKeys.has(key)
      ).length,
    [decisions, remappedCreateKeys]
  );

  const deniedCount = useMemo(() => {
    if (!preview) return 0;
    return preview.willCreate.filter(
      (row) =>
        !remappedCreateKeys.has(row.create_key) &&
        (decisions[row.create_key] ?? "deny") === "deny"
    ).length;
  }, [preview, decisions, remappedCreateKeys]);

  const remappedCount = remappedCreateKeys.size;

  function resetPreviewState() {
    setPreview(null);
    setPreviewError(null);
    setResult(null);
    setDecisions({});
    setColumnDenies({});
    setNameRemaps({});
    setExpandedDupes({});
    setRemapFilter({});
  }

  function appendUploadFiles(formData: FormData) {
    if (rosterFile) formData.append("roster", rosterFile);
    if (socialFile) formData.append("social", socialFile);
    if (audienceFile) formData.append("audience", audienceFile);
  }

  function handleAutoSortFiles(files: FileList | null) {
    if (!files?.length) return;

    let nextRoster: File | null = null;
    let nextSocial: File | null = null;
    let nextAudience: File | null = null;
    const unrecognized: string[] = [];
    const duplicates: string[] = [];

    for (const file of Array.from(files)) {
      const kind = classifyMetabaseDownloadName(file.name);
      if (!kind) {
        unrecognized.push(file.name);
      } else if (kind === "roster") {
        if (nextRoster) duplicates.push(file.name);
        else nextRoster = file;
      } else if (kind === "social") {
        if (nextSocial) duplicates.push(file.name);
        else nextSocial = file;
      } else if (kind === "audience") {
        if (nextAudience) duplicates.push(file.name);
        else nextAudience = file;
      }
    }

    if (nextRoster) setRosterFile(nextRoster);
    if (nextSocial) setSocialFile(nextSocial);
    if (nextAudience) setAudienceFile(nextAudience);
    resetPreviewState();

    const assigned = [nextRoster, nextSocial, nextAudience].filter(Boolean).length;
    const details: string[] = [`Sorted ${assigned} file${assigned === 1 ? "" : "s"}`];
    if (unrecognized.length) details.push(`unrecognized: ${unrecognized.join(", ")}`);
    if (duplicates.length) details.push(`duplicate type: ${duplicates.join(", ")}`);
    setFileSortMessage(details.join(" · "));
  }

  async function handlePreview() {
    if (!hasAnyFile) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);

    const formData = new FormData();
    appendUploadFiles(formData);

    try {
      const res = await fetch("/api/admin/import/metabase-preview", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = (await res.json()) as MetabaseImportPreview & { error?: string };
      if (!res.ok) {
        setPreviewError(typeof data.error === "string" ? data.error : "Preview failed");
        return;
      }
      setPreview(data);
      const next: Record<string, CreateDecision> = {};
      for (const row of data.willCreate) {
        next[row.create_key] = "deny";
      }
      setDecisions(next);
      setColumnDenies({});
      setNameRemaps({});
      setExpandedDupes({});
      setRemapFilter({});
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Preview request failed");
    } finally {
      setPreviewing(false);
    }
  }

  function setAllCreates(decision: CreateDecision) {
    if (!preview) return;
    const next: Record<string, CreateDecision> = {};
    for (const row of preview.willCreate) {
      if (remappedCreateKeys.has(row.create_key)) continue;
      next[row.create_key] = decision;
    }
    setDecisions((prev) => ({ ...prev, ...next }));
  }

  function toggleColumnDeny(
    athleteId: string,
    column: MetabaseUpdateColumn,
    denied: boolean
  ) {
    setColumnDenies((prev) => ({
      ...prev,
      [athleteId]: { ...prev[athleteId], [column]: denied },
    }));
  }

  function denyAllSportChanges() {
    if (!preview) return;
    setColumnDenies((prev) => {
      const next = { ...prev };
      for (const u of preview.willUpdate) {
        if (!u.sport_will_change) continue;
        next[u.athlete_id] = { ...next[u.athlete_id], sport: true };
      }
      return next;
    });
  }

  function setRemap(createKey: string, athleteId: string) {
    setNameRemaps((prev) => {
      const next = { ...prev };
      if (!athleteId) delete next[createKey];
      else next[createKey] = athleteId;
      return next;
    });
    if (athleteId) {
      setDecisions((prev) => ({ ...prev, [createKey]: "deny" }));
    }
  }

  async function handleConfirm() {
    if (!hasAnyFile || !preview) return;
    if (preview.ambiguous.length > 0) return;

    setCommitting(true);
    setResult(null);

    const approvedCreateKeys = preview.willCreate
      .filter(
        (row) =>
          decisions[row.create_key] === "approve" && !remappedCreateKeys.has(row.create_key)
      )
      .map((row) => row.create_key);

    const deniedUpdates = Object.entries(columnDenies)
      .map(([athlete_id, denyMap]) => {
        const deny = (["sport", "social", "audience"] as MetabaseUpdateColumn[]).filter(
          (c) => denyMap[c]
        );
        return { athlete_id, deny };
      })
      .filter((r) => r.deny.length > 0);

    const nameRemapsPayload = Object.entries(nameRemaps)
      .filter(([, athlete_id]) => Boolean(athlete_id))
      .map(([create_key, athlete_id]) => ({ create_key, athlete_id }));

    const formData = new FormData();
    appendUploadFiles(formData);
    formData.append("type", "metabase_monthly");
    formData.append("approvedCreateKeys", JSON.stringify(approvedCreateKeys));
    formData.append("deniedUpdates", JSON.stringify(deniedUpdates));
    formData.append("nameRemaps", JSON.stringify(nameRemapsPayload));

    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setResult({ error: typeof data.error === "string" ? data.error : "Import failed" });
      } else {
        setResult(data);
      }
    } catch (e: unknown) {
      setResult({
        error: e instanceof Error ? e.message : "Import request failed",
      });
    } finally {
      setCommitting(false);
    }
  }

  const confirmDisabled =
    !hasAnyFile ||
    !preview ||
    committing ||
    previewing ||
    (preview?.ambiguous.length ?? 0) > 0;

  return (
    <div className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="mb-1 text-lg font-medium text-[#F4F1EB]">Metabase Monthly Sync</h2>
      <p className="mb-4 text-sm text-[#B9B2A6]">
        Download each Metabase table as CSV (or a real multi-sheet .xlsx), then preview matches
        before importing. Salesforce / W3 columns are ignored. Existing agent assignments are never
        overwritten.
      </p>

      <div className="mb-4 rounded-md border border-white/10 bg-[#101513] p-3 text-sm text-[#D7D0C4]">
        <p className="mb-1 font-medium text-[#F4F1EB]">How to export from Metabase</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            Prefer <strong>Download → .csv</strong> for each table (Roster, Owned Social, Audience).
            Select all three together below; timestamped Metabase names such as
            <strong> action_sports_roster_…</strong>, <strong>action_sports_owned_social_…</strong>,
            and <strong>action_sports_audience_…</strong> are sorted automatically.
          </li>
          <li>
            Or combine sheets into one real Excel workbook — do not rename a CSV to .xlsx (that
            causes “invalid signature”).
          </li>
          <li>
            Columns: Roster = Name, Agent, Sport · Social = Name, Total Followers, Avg. ER (20p),
            platform metrics · Audience = Name, Audience Category, Audience Name, IG Audience % / #
          </li>
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
            Select Metabase downloads (auto-sort)
          </label>
          <input
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => handleAutoSortFiles(e.target.files)}
            className={FILE_INPUT_CLASS}
          />
          {fileSortMessage && (
            <p className="mt-1 text-xs text-[#B9B2A6]">{fileSortMessage}</p>
          )}
        </div>

        <div className="text-xs font-medium uppercase tracking-wide text-[#837D74]">
          Assigned files (you can override individually)
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
              Roster (.csv / .xlsx)
            </label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              onChange={(e) => {
                setRosterFile(e.target.files?.[0] ?? null);
                resetPreviewState();
              }}
              className={FILE_INPUT_CLASS}
            />
            {rosterFile && (
              <p className="mt-1 truncate text-xs text-[#B9B2A6]">{rosterFile.name}</p>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">
              Social / Owned Social
            </label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              onChange={(e) => {
                setSocialFile(e.target.files?.[0] ?? null);
                resetPreviewState();
              }}
              className={FILE_INPUT_CLASS}
            />
            {socialFile && (
              <p className="mt-1 truncate text-xs text-[#B9B2A6]">{socialFile.name}</p>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#D7D0C4]">Audience</label>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              onChange={(e) => {
                setAudienceFile(e.target.files?.[0] ?? null);
                resetPreviewState();
              }}
              className={FILE_INPUT_CLASS}
            />
            {audienceFile && (
              <p className="mt-1 truncate text-xs text-[#B9B2A6]">{audienceFile.name}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!hasAnyFile || previewing || committing}
            className="rounded-md border border-white/20 bg-[#101513] px-4 py-2 text-sm text-[#ECE7DF] hover:bg-[#1A211D] disabled:opacity-50"
          >
            {previewing ? "Building preview…" : "Preview mapping"}
          </button>
        </div>

        {previewError && (
          <div className="rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3 text-sm text-[#F1A2A2]">
            {previewError}
          </div>
        )}

        {preview && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3 text-sm text-[#D7D0C4]">
              <span>
                Sheets:{" "}
                {[
                  preview.sheets.roster && "Roster",
                  preview.sheets.social && "Social",
                  preview.sheets.audience && "Audience",
                ]
                  .filter(Boolean)
                  .join(", ") || "none"}
              </span>
              <span>· Update: {preview.counts.will_update}</span>
              <span>· Add candidates: {preview.counts.will_create}</span>
              <span>· Not updated: {preview.counts.not_updated}</span>
              <span>· Ambiguous: {preview.counts.ambiguous}</span>
              <span>· Duplicates: {preview.counts.duplicates}</span>
            </div>

            {preview.ambiguous.length > 0 && (
              <Section title="Ambiguous matches (resolve before import)" tone="warn">
                <p className="mb-2 text-sm text-[#F1A2A2]">
                  Confirm Import is disabled until these names are fixed on the roster.
                </p>
                <SimpleTable
                  columns={["Name", "Sheet", "Candidates"]}
                  rows={preview.ambiguous.map((a) => [
                    a.display_name,
                    a.sheet,
                    a.candidate_names.join("; ") || a.candidate_ids.join("; "),
                  ])}
                />
              </Section>
            )}

            {preview.duplicatesInFile.length > 0 && (
              <Section title="Duplicates in file" tone="warn">
                <p className="mb-2 text-sm text-[#B9B2A6]">
                  Audience: only identical Category + Audience Name pairs are flagged; multiple
                  different brands for one athlete is expected. Import still uses last-write /
                  upsert on conflict keys.
                </p>
                <div className="max-h-96 overflow-auto">
                  <table className="min-w-full divide-y divide-white/10 text-sm">
                    <thead className="sticky top-0 bg-[#1A211D]">
                      <tr>
                        {["Sheet", "Name", "Rows", "Reason", ""].map((h) => (
                          <th
                            key={h || "expand"}
                            className="px-3 py-2 text-left font-medium text-[#D7D0C4]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 bg-[#151A17]">
                      {preview.duplicatesInFile.map((d, i) => {
                        const key = `${d.sheet}:${d.display_name}:${i}`;
                        const open = expandedDupes[key];
                        return (
                          <Fragment key={key}>
                            <tr>
                              <td className="px-3 py-2 text-[#B9B2A6]">{d.sheet}</td>
                              <td className="px-3 py-2 text-[#ECE7DF]">{d.display_name}</td>
                              <td className="px-3 py-2 text-[#B9B2A6]">{d.row_count}</td>
                              <td className="px-3 py-2 text-[#B9B2A6]">{d.reason}</td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedDupes((prev) => ({
                                      ...prev,
                                      [key]: !prev[key],
                                    }))
                                  }
                                  className="text-xs text-[#DBEEE0] underline"
                                >
                                  {open ? "Hide" : "Details"}
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={5} className="bg-[#0E1210] px-3 py-2">
                                  <ul className="list-inside list-disc space-y-1 text-xs text-[#B9B2A6]">
                                    {d.occurrences.map((o) => (
                                      <li key={`${o.rowIndex}-${o.summary}`}>
                                        row {o.rowIndex}: {o.summary}
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            <Section title="Header mapping">
              <SimpleTable
                columns={["Sheet", "Source", "Target"]}
                rows={preview.headerMapping.map((h) => [h.sheet, h.source, h.target])}
                maxRows={40}
              />
            </Section>

            <Section title={`Will update (${preview.willUpdate.length})`}>
              <p className="mb-2 text-sm text-[#B9B2A6]">
                Blank file sport does not clear roster sport. Use Deny to skip a column on confirm.
              </p>
              {preview.willUpdate.some((u) => u.sport_will_change) && (
                <div className="mb-2">
                  <button
                    type="button"
                    onClick={denyAllSportChanges}
                    className="rounded-md border border-white/20 bg-[#101513] px-3 py-1.5 text-xs text-[#ECE7DF] hover:bg-[#1A211D]"
                  >
                    Deny all sport changes
                  </button>
                </div>
              )}
              <div className="max-h-[28rem] overflow-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="sticky top-0 bg-[#1A211D]">
                    <tr>
                      {[
                        "Name",
                        "Columns",
                        "Sport",
                        "Social",
                        "Audience",
                        "Deny",
                        "Agents (preserved)",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left font-medium text-[#D7D0C4]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-[#151A17]">
                    {preview.willUpdate.map((u) => {
                      const denies = columnDenies[u.athlete_id] ?? {};
                      return (
                        <tr key={u.athlete_id}>
                          <td className="px-3 py-2 text-[#ECE7DF]">{u.display_name}</td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {u.columns_updating.length
                              ? u.columns_updating.join(", ")
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">{sportCell(u)}</td>
                          <td className="max-w-xs px-3 py-2 text-[#B9B2A6]">
                            {socialDiffSummary(u)}
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {audienceDiffSummary(u)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
                              {u.columns_updating.includes("sport") && (
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(denies.sport)}
                                    onChange={(e) =>
                                      toggleColumnDeny(u.athlete_id, "sport", e.target.checked)
                                    }
                                  />
                                  Deny sport
                                </label>
                              )}
                              {u.columns_updating.includes("social") && (
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(denies.social)}
                                    onChange={(e) =>
                                      toggleColumnDeny(u.athlete_id, "social", e.target.checked)
                                    }
                                  />
                                  Deny social
                                </label>
                              )}
                              {u.columns_updating.includes("audience") && (
                                <label className="inline-flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(denies.audience)}
                                    onChange={(e) =>
                                      toggleColumnDeny(
                                        u.athlete_id,
                                        "audience",
                                        e.target.checked
                                      )
                                    }
                                  />
                                  Deny audience
                                </label>
                              )}
                              {u.columns_updating.length === 0 && (
                                <span className="text-[#837D74]">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {u.current_agents
                              .map((a) => `${a.email}${a.is_primary ? " (primary)" : ""}`)
                              .join(", ") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {preview.willUpdate.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-4 text-center text-[#B9B2A6]"
                        >
                          None
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`Will add to roster (${preview.willCreate.length})`}>
              <p className="mb-2 text-sm text-[#B9B2A6]">
                Default is <strong className="text-[#ECE7DF]">Deny</strong>. Approve only athletes
                you want created, or map a file name to an existing athlete (saves as a lasting
                alias on confirm).
              </p>
              {preview.willCreate.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAllCreates("approve")}
                    className="rounded-md border border-white/20 bg-[#101513] px-3 py-1.5 text-xs text-[#ECE7DF] hover:bg-[#1A211D]"
                  >
                    Approve all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllCreates("deny")}
                    className="rounded-md border border-white/20 bg-[#101513] px-3 py-1.5 text-xs text-[#ECE7DF] hover:bg-[#1A211D]"
                  >
                    Deny all
                  </button>
                </div>
              )}
              <div className="max-h-96 overflow-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="sticky top-0 bg-[#1A211D]">
                    <tr>
                      {[
                        "Decision",
                        "Name",
                        "Map to existing",
                        "Sport",
                        "File agent",
                        "Social",
                        "Audience",
                        "Sheets",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left font-medium text-[#D7D0C4]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 bg-[#151A17]">
                    {preview.willCreate.map((row) => {
                      const remappedId = nameRemaps[row.create_key];
                      const decision = remappedId
                        ? "deny"
                        : (decisions[row.create_key] ?? "deny");
                      const filter = (remapFilter[row.create_key] ?? "").toLowerCase();
                      const options = (preview.rosterOptions ?? [])
                        .filter((o) =>
                          filter
                            ? o.display_name.toLowerCase().includes(filter)
                            : true
                        )
                        .slice(0, 80);
                      return (
                        <tr key={row.create_key}>
                          <td className="px-3 py-2">
                            {remappedId ? (
                              <span className="text-xs text-[#DBEEE0]">Remapped</span>
                            ) : (
                              <div className="flex gap-2">
                                <label className="inline-flex items-center gap-1 text-[#DBEEE0]">
                                  <input
                                    type="radio"
                                    name={`create-${row.create_key}`}
                                    checked={decision === "approve"}
                                    onChange={() =>
                                      setDecisions((prev) => ({
                                        ...prev,
                                        [row.create_key]: "approve",
                                      }))
                                    }
                                  />
                                  Approve
                                </label>
                                <label className="inline-flex items-center gap-1 text-[#B9B2A6]">
                                  <input
                                    type="radio"
                                    name={`create-${row.create_key}`}
                                    checked={decision === "deny"}
                                    onChange={() =>
                                      setDecisions((prev) => ({
                                        ...prev,
                                        [row.create_key]: "deny",
                                      }))
                                    }
                                  />
                                  Deny
                                </label>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[#ECE7DF]">{row.display_name}</td>
                          <td className="px-3 py-2">
                            <div className="flex min-w-[12rem] flex-col gap-1">
                              <input
                                type="search"
                                placeholder="Search athlete…"
                                value={remapFilter[row.create_key] ?? ""}
                                onChange={(e) =>
                                  setRemapFilter((prev) => ({
                                    ...prev,
                                    [row.create_key]: e.target.value,
                                  }))
                                }
                                className="rounded border border-white/15 bg-[#0E1210] px-2 py-1 text-xs text-[#ECE7DF]"
                              />
                              <select
                                value={remappedId ?? ""}
                                onChange={(e) => setRemap(row.create_key, e.target.value)}
                                className="rounded border border-white/15 bg-[#0E1210] px-2 py-1 text-xs text-[#ECE7DF]"
                              >
                                <option value="">— create / deny —</option>
                                {remappedId &&
                                  !options.some((o) => o.athlete_id === remappedId) && (
                                    <option value={remappedId}>
                                      {(preview.rosterOptions ?? []).find(
                                        (o) => o.athlete_id === remappedId
                                      )?.display_name ?? remappedId}
                                    </option>
                                  )}
                                {options.map((o) => (
                                  <option key={o.athlete_id} value={o.athlete_id}>
                                    {o.display_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">{row.sport ?? "—"}</td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {row.file_agent ?? "—"}
                            {row.file_agent
                              ? row.agent_resolved
                                ? " ✓"
                                : " (unresolved)"
                              : ""}
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {row.has_social ? "yes" : "—"}
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {row.has_audience ? String(row.audience_row_count) : "—"}
                          </td>
                          <td className="px-3 py-2 text-[#B9B2A6]">
                            {row.appears_on_sheets.join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                    {preview.willCreate.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-4 text-center text-[#B9B2A6]"
                        >
                          No new athletes to add
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`Not updated (${preview.notUpdated.length})`}>
              <p className="mb-2 text-sm text-[#B9B2A6]">
                Athletes already in AgentDash whose names do not appear in this Metabase file.
              </p>
              <div className="max-h-56 overflow-auto">
                <SimpleTable
                  columns={["Name"]}
                  rows={preview.notUpdated.map((n) => [n.display_name])}
                />
              </div>
            </Section>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {committing
                ? "Importing…"
                : `Confirm Import (${preview.counts.will_update} updates, ${approvedCount} adds, ${remappedCount} remapped, ${deniedCount} denied)`}
            </button>
          </div>
        )}

        {result && (
          <div
            className={`rounded-md border p-4 text-sm ${
              result.error
                ? "border-[#8C3A3A]/50 bg-[#3A1E1E] text-[#F1A2A2]"
                : "border-[#2E7040]/40 bg-[#142018] text-[#DBEEE0]"
            }`}
          >
            {typeof result.error === "string" ? (
              <p>{result.error}</p>
            ) : (
              <>
                <p className="mb-2 font-medium text-[#F4F1EB]">Import complete</p>
                <ul className="list-inside list-disc space-y-0.5 text-[#D7D0C4]">
                  <li>Approved creates: {String(result.approved_creates ?? 0)}</li>
                  <li>Denied creates: {String(result.denied_creates ?? 0)}</li>
                  <li>Remapped: {String(result.remapped ?? 0)}</li>
                  <li>
                    Inserted: {String(result.inserted ?? 0)} · Updated:{" "}
                    {String(result.updated ?? 0)} · Skipped: {String(result.skipped ?? 0)} ·
                    Failed: {String(result.failed ?? 0)}
                  </li>
                </ul>
                {Array.isArray(result.failures) && result.failures.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[#B9B2A6]">
                      Failures / skips ({result.failures.length})
                    </summary>
                    <ul className="mt-2 max-h-48 list-inside list-disc overflow-auto text-xs text-[#B9B2A6]">
                      {(
                        result.failures as Array<{
                          sheet?: string;
                          rowIndex?: number;
                          reason?: string;
                        }>
                      )
                        .slice(0, 100)
                        .map((f, i) => (
                          <li key={i}>
                            {f.sheet} row {f.rowIndex}: {f.reason}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        tone === "warn"
          ? "border-[#8C3A3A]/40 bg-[#2A1A1A]"
          : "border-white/10 bg-[#101513]"
      }`}
    >
      <h3 className="mb-2 text-sm font-medium text-[#F4F1EB]">{title}</h3>
      {children}
    </div>
  );
}

function SimpleTable({
  columns,
  rows,
  maxRows,
}: {
  columns: string[];
  rows: string[][];
  maxRows?: number;
}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <>
      <table className="min-w-full divide-y divide-white/10 text-sm">
        <thead className="bg-[#1A211D]">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-medium text-[#D7D0C4]">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 bg-[#151A17]">
          {shown.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-[#B9B2A6]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-3 text-center text-[#B9B2A6]"
              >
                None
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <p className="mt-1 text-xs text-[#B9B2A6]">
          Showing {maxRows} of {rows.length}
        </p>
      )}
    </>
  );
}
