"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Contact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

type TargetListRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  website: string | null;
  hq_phone: string | null;
  company_description: string | null;
  past_partnerships: string | null;
  personal_notes: string | null;
  contacts: Contact[];
};

const UNCATEGORIZED_LABEL = "Uncategorized";

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
  "Contact Name",
  "Role",
  "Email",
  "Number",
  "HQ Number",
  "Company Website",
  "Previous Partnerships",
  "Company Description",
  "Personal Notes",
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
      return next;
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
        { header: "Contact Name", width: 24 },
        { header: "Role", width: 26 },
        { header: "Email", width: 32 },
        { header: "Number", width: 16 },
        { header: "HQ Number", width: 16 },
        { header: "Company Website", width: 32 },
        { header: "Previous Partnerships", width: 36 },
        { header: "Company Description", width: 48 },
        { header: "Personal Notes", width: 36 },
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

          const contactName = c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : "";

          const excelRow = ws.addRow([
            showCategory ? row.category ?? UNCATEGORIZED_LABEL : "",
            showCompany ? row.company_name : "",
            contactName,
            c?.role ?? "",
            c?.email ?? "",
            c?.phone ?? "",
            showCompany ? row.hq_phone ?? "" : "",
            showCompany ? row.website ?? "" : "",
            showCompany ? row.past_partnerships ?? "" : "",
            showCompany ? row.company_description ?? "" : "",
            showCompany ? row.personal_notes ?? "" : "",
          ]);

          excelRow.alignment = { vertical: "top", wrapText: true };

          if (yellow) {
            // Highlight all "yellow" columns (everything except Category) per spec.
            for (let col = 2; col <= 11; col++) {
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
        <div className="flex items-center gap-3">
          {rows && rows.length > 0 ? (
            <span className="whitespace-nowrap text-xs text-[#B9B2A6]">
              {rows.length} {rows.length === 1 ? "company" : "companies"}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || loading || !rows || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-3 py-1.5 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
      </header>

      {globalError ? (
        <div className="border-b border-[#8C3A3A]/50 bg-[#3A1E1E] px-4 py-2 text-xs text-[#F1A2A2]">{globalError}</div>
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
                  <Th key={c}>{c}</Th>
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
                  ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()
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
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Contact Name */}
                    <Td className={yellowCell}>
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

                    {/* Email */}
                    <Td className={yellowCell}>
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
                          display={(v) =>
                            v ? (
                              <a
                                href={v}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-[#CEE4D4] hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {v.replace(/^https?:\/\//, "")}
                              </a>
                            ) : (
                              <span className="text-[#8E877A]">—</span>
                            )
                          }
                        />
                      ) : (
                        <span aria-hidden="true"></span>
                      )}
                    </Td>

                    {/* Previous Partnerships */}
                    <Td className={yellowCell}>
                      {fr.showCompany ? (
                        <EditableCell
                          value={row.past_partnerships ?? ""}
                          placeholder="Known previous sponsorships / partnerships…"
                          multiline
                          minHeightPx={60}
                          onSave={async (next) => {
                            await savePipelinePatch(fr.rowIndex, { past_partnerships: next || null });
                            patchRowLocal(fr.rowIndex, { past_partnerships: next || null });
                          }}
                        />
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
                      {fr.showCompany ? (
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap border border-white/10 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[#B9B2A6]">
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
