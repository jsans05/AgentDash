"use client";

import { useEffect, useMemo, useState } from "react";

type TemplateMode = "one_to_one" | "general_high_level" | "general_athlete_led" | "multi_athlete";
type TemplateRow = {
  mode: TemplateMode;
  subject_template: string;
  body_template: string;
  is_active: boolean;
};
type ToneRow = {
  sample_index: 1 | 2 | 3;
  sample_title: string;
  sample_content: string;
};

const MODE_LABELS: Record<TemplateMode, string> = {
  one_to_one: "One-to-One",
  general_high_level: "General High-Level",
  general_athlete_led: "General Athlete-Led",
  multi_athlete: "Multi-Athlete",
};

const EMPTY_TEMPLATE_ROWS: TemplateRow[] = (Object.keys(MODE_LABELS) as TemplateMode[]).map((mode) => ({
  mode,
  subject_template: "",
  body_template: "",
  is_active: true,
}));

const EMPTY_TONE_ROWS: ToneRow[] = [
  { sample_index: 1, sample_title: "", sample_content: "" },
  { sample_index: 2, sample_title: "", sample_content: "" },
  { sample_index: 3, sample_title: "", sample_content: "" },
];

export function EmailTemplatesClient({ canManageTemplates }: { canManageTemplates: boolean }) {
  const [templates, setTemplates] = useState<TemplateRow[]>(EMPTY_TEMPLATE_ROWS);
  const [toneRows, setToneRows] = useState<ToneRow[]>(EMPTY_TONE_ROWS);
  const [loadingTemplates, setLoadingTemplates] = useState(canManageTemplates);
  const [loadingTone, setLoadingTone] = useState(true);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [savingTone, setSavingTone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadToneRows() {
      setLoadingTone(true);
      try {
        const res = await fetch("/api/ai/tone-emails", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load tone samples");
        const byIndex = new Map<number, ToneRow>();
        for (const row of Array.isArray(data.samples) ? data.samples : []) {
          byIndex.set(Number(row.sample_index), {
            sample_index: Number(row.sample_index) as 1 | 2 | 3,
            sample_title: String(row.sample_title ?? ""),
            sample_content: String(row.sample_content ?? ""),
          });
        }
        const merged = EMPTY_TONE_ROWS.map((row) => byIndex.get(row.sample_index) ?? row);
        if (!cancelled) setToneRows(merged);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tone samples");
      } finally {
        if (!cancelled) setLoadingTone(false);
      }
    }
    void loadToneRows();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canManageTemplates) return;
    let cancelled = false;
    async function loadTemplates() {
      setLoadingTemplates(true);
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
        const merged = EMPTY_TEMPLATE_ROWS.map((base) => map.get(base.mode) ?? base);
        if (!cancelled) setTemplates(merged);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load templates");
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [canManageTemplates]);

  const canSaveTemplates = useMemo(
    () =>
      templates.every((row) => {
        if (!row.is_active) return true;
        return row.subject_template.trim().length > 0 && row.body_template.trim().length > 0;
      }),
    [templates]
  );

  const canSaveTone = useMemo(
    () => toneRows.filter((row) => row.sample_content.trim().length > 0).length <= 3,
    [toneRows]
  );

  async function saveTemplates() {
    setSavingTemplates(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/email-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ templates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save templates");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save templates");
    } finally {
      setSavingTemplates(false);
    }
  }

  async function saveToneRows() {
    setSavingTone(true);
    setError(null);
    try {
      const samples = toneRows
        .filter((row) => row.sample_content.trim().length > 0)
        .map((row) => ({
          sample_index: row.sample_index,
          sample_title: row.sample_title.trim() || null,
          sample_content: row.sample_content.trim(),
        }));
      const res = await fetch("/api/ai/tone-emails", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ samples }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save tone samples");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tone samples");
    } finally {
      setSavingTone(false);
    }
  }

  function patchTemplate(mode: TemplateMode, patch: Partial<TemplateRow>) {
    setTemplates((prev) => prev.map((row) => (row.mode === mode ? { ...row, ...patch } : row)));
  }
  function patchTone(index: 1 | 2 | 3, patch: Partial<ToneRow>) {
    setToneRows((prev) => prev.map((row) => (row.sample_index === index ? { ...row, ...patch } : row)));
  }

  function importToneFile(index: 1 | 2 | 3, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "").trim();
      patchTone(index, { sample_content: text });
      if (!toneRows.find((row) => row.sample_index === index)?.sample_title.trim()) {
        patchTone(index, { sample_title: file.name.replace(/\.[^.]+$/, "") });
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Email Templates & Tone</h1>
        <p className="mt-1 text-sm text-[#B9B2A6]">
          Save up to 3 personal outreach examples so AI can mirror your tone. Global templates remain admin-managed.
        </p>
      </header>

      {error ? <div className="rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] p-3 text-sm text-[#FFD2D2]">{error}</div> : null}

      <section className="rounded-lg border border-white/10 bg-[#1A211D] p-4">
        <h2 className="mb-2 text-base font-medium text-[#F4F1EB]">Your Tone Reference Emails (max 3)</h2>
        <p className="mb-4 text-xs text-[#B9B2A6]">
          Paste or upload your own outreach examples. AI uses these for style/tone cues, not verbatim copying.
        </p>
        {loadingTone ? (
          <div className="text-sm text-[#B9B2A6]">Loading tone samples…</div>
        ) : (
          <div className="space-y-4">
            {toneRows.map((row) => (
              <div key={row.sample_index} className="rounded-md border border-white/10 bg-[#151A17] p-3 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">Sample {row.sample_index}</div>
                <input
                  type="text"
                  value={row.sample_title}
                  onChange={(e) => patchTone(row.sample_index, { sample_title: e.target.value })}
                  className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                  placeholder="Optional title (e.g. Motorsport punchy outreach)"
                />
                <textarea
                  value={row.sample_content}
                  onChange={(e) => patchTone(row.sample_index, { sample_content: e.target.value })}
                  rows={6}
                  className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                  placeholder="Paste email body here..."
                />
                <label className="inline-flex items-center gap-2 text-xs text-[#CEE4D4] cursor-pointer">
                  <input
                    type="file"
                    accept=".txt,.md,.eml"
                    className="hidden"
                    onChange={(e) => importToneFile(row.sample_index, e.target.files?.[0] ?? null)}
                  />
                  Upload text file
                </label>
              </div>
            ))}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void saveToneRows()}
                disabled={savingTone || !canSaveTone}
                className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
              >
                {savingTone ? "Saving…" : "Save tone samples"}
              </button>
            </div>
          </div>
        )}
      </section>

      {canManageTemplates ? (
        <section className="rounded-lg border border-white/10 bg-[#1A211D] p-4">
          <h2 className="mb-2 text-base font-medium text-[#F4F1EB]">Admin Global Templates</h2>
          <p className="mb-4 text-xs text-[#B9B2A6]">
            Leave token placeholders (for example: <code>{"{{company_name}}"}</code>) where variable substitution is expected.
          </p>
          {loadingTemplates ? (
            <div className="text-sm text-[#B9B2A6]">Loading templates…</div>
          ) : (
            <div className="space-y-4">
              {templates.map((row) => (
                <section key={row.mode} className="rounded-md border border-white/10 bg-[#151A17] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-[#F4F1EB]">{MODE_LABELS[row.mode]}</h3>
                    <label className="inline-flex items-center gap-2 text-xs text-[#D7D0C4]">
                      <input
                        type="checkbox"
                        checked={row.is_active}
                        onChange={(e) => patchTemplate(row.mode, { is_active: e.target.checked })}
                      />
                      Active
                    </label>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={row.subject_template}
                      onChange={(e) => patchTemplate(row.mode, { subject_template: e.target.value })}
                      className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                      placeholder="Subject template"
                    />
                    <textarea
                      value={row.body_template}
                      onChange={(e) => patchTemplate(row.mode, { body_template: e.target.value })}
                      rows={8}
                      className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
                      placeholder="Body template"
                    />
                  </div>
                </section>
              ))}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void saveTemplates()}
                  disabled={savingTemplates || !canSaveTemplates}
                  className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
                >
                  {savingTemplates ? "Saving…" : "Save global templates"}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
