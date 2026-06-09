"use client";

import { useEffect, useMemo, useState } from "react";

type TemplateMode = "one_to_one" | "general_high_level" | "general_athlete_led" | "multi_athlete";

type TemplateRow = {
  mode: TemplateMode;
  subject_template: string;
  body_template: string;
  is_active: boolean;
};

const MODE_LABELS: Record<TemplateMode, string> = {
  one_to_one: "One-to-One",
  general_high_level: "General High-Level",
  general_athlete_led: "General Athlete-Led",
  multi_athlete: "Multi-Athlete",
};

const EMPTY_ROWS: TemplateRow[] = (Object.keys(MODE_LABELS) as TemplateMode[]).map((mode) => ({
  mode,
  subject_template: "",
  body_template: "",
  is_active: true,
}));

export function EmailTemplatesAdminClient() {
  const [rows, setRows] = useState<TemplateRow[]>(EMPTY_ROWS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/email-templates", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load templates");
        const map = new Map<string, TemplateRow>();
        for (const row of Array.isArray(data.templates) ? data.templates : []) {
          map.set(String(row.mode), {
            mode: row.mode,
            subject_template: String(row.subject_template ?? ""),
            body_template: String(row.body_template ?? ""),
            is_active: Boolean(row.is_active),
          });
        }
        const merged = EMPTY_ROWS.map((base) => map.get(base.mode) ?? base);
        if (!cancelled) setRows(merged);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load templates");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave = useMemo(
    () =>
      rows.every((row) => {
        if (!row.is_active) return true;
        return row.subject_template.trim().length > 0 && row.body_template.trim().length > 0;
      }),
    [rows]
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ templates: rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save templates");
      const fresh = Array.isArray(data.templates) ? data.templates : rows;
      setRows(
        fresh.map((row: any) => ({
          mode: row.mode as TemplateMode,
          subject_template: String(row.subject_template ?? ""),
          body_template: String(row.body_template ?? ""),
          is_active: Boolean(row.is_active),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save templates");
    } finally {
      setSaving(false);
    }
  }

  function patchRow(mode: TemplateMode, patch: Partial<TemplateRow>) {
    setRows((prev) => prev.map((row) => (row.mode === mode ? { ...row, ...patch } : row)));
  }

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Email Templates</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          Admin-managed outreach skeletons used by AI generation. Leave token placeholders (for example:
          {" "}
          <code>{"{{company_name}}"}</code>) in place where variable substitution is expected.
        </p>
      </header>

      {error ? <div className="rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3 text-sm text-[#FFD2D2]">{error}</div> : null}

      {loading ? (
        <div className="rounded-md border border-white/10 bg-[#1A211D] p-4 text-sm text-[#B9B2A6]">Loading templates…</div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <section key={row.mode} className="rounded-lg border border-white/10 bg-[#1A211D] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-medium text-[#F4F1EB]">{MODE_LABELS[row.mode]}</h2>
                <label className="inline-flex items-center gap-2 text-xs text-[#D7D0C4]">
                  <input
                    type="checkbox"
                    checked={row.is_active}
                    onChange={(e) => patchRow(row.mode, { is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-[#B9B2A6]">Subject template</label>
                  <input
                    type="text"
                    value={row.subject_template}
                    onChange={(e) => patchRow(row.mode, { subject_template: e.target.value })}
                    className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                    placeholder="Subject template"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-[#B9B2A6]">Body template</label>
                  <textarea
                    value={row.body_template}
                    onChange={(e) => patchRow(row.mode, { body_template: e.target.value })}
                    rows={10}
                    className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                    placeholder="Body template"
                  />
                </div>
              </div>
            </section>
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !canSave}
              className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save templates"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
