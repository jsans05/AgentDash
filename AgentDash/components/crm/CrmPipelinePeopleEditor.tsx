"use client";

import { useEffect, useState } from "react";

export type PipelinePersonDraft = {
  name: string;
  email: string;
  linkedin_url: string;
  source_contact_id?: string | null;
};

type PersonInput = {
  name?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  source_contact_id?: string | null;
};

type Props = {
  initialPeople: PersonInput[];
  /** Merged into `contact_emails` on save so list-only legacy emails are preserved. */
  legacyContactEmails: string[];
  disabled?: boolean;
  /** e.g. row `updated_at` — when it changes after refresh, reset local draft. */
  syncKey: string;
  onSave: (payload: {
    relevant_people: Array<{
      name: string | null;
      email: string | null;
      linkedin_url: string | null;
      source_contact_id?: string | null;
    }>;
    contact_emails: string[];
  }) => Promise<boolean>;
};

function toDraftRows(initial: PersonInput[]): PipelinePersonDraft[] {
  if (!initial?.length) return [{ name: "", email: "", linkedin_url: "" }];
  return initial.map((p) => ({
    name: (p.name ?? "").trim() ? String(p.name) : "",
    email: (p.email ?? "").trim() ? String(p.email) : "",
    linkedin_url: (p.linkedin_url ?? "").trim() ? String(p.linkedin_url) : "",
    source_contact_id: p.source_contact_id ?? null,
  }));
}

function rowHasData(r: PipelinePersonDraft): boolean {
  return [r.name, r.email, r.linkedin_url].some((s) => String(s).trim() !== "");
}

function normalizeEmailList(raw: Iterable<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const x of raw) {
    const email = String(x ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    set.add(email);
  }
  return [...set];
}

function buildPeopleSavePayload(draft: PipelinePersonDraft[], legacyContactEmails: string[]) {
  const people = draft
    .filter(rowHasData)
    .map((r) => {
      const base: {
        name: string | null;
        email: string | null;
        linkedin_url: string | null;
        source_contact_id?: string | null;
      } = {
        name: r.name.trim() || null,
        email: r.email.trim() ? r.email.trim().toLowerCase() : null,
        linkedin_url: r.linkedin_url.trim() || null,
      };
      if (r.source_contact_id) base.source_contact_id = r.source_contact_id;
      return base;
    });

  const fromPeople = normalizeEmailList(people.map((p) => p.email));
  const fromLegacy = normalizeEmailList(legacyContactEmails);
  const contact_emails = normalizeEmailList([...fromPeople, ...fromLegacy]);

  return { relevant_people: people, contact_emails };
}

export function CrmPipelinePeopleEditor({
  initialPeople,
  legacyContactEmails,
  disabled,
  syncKey,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<PipelinePersonDraft[]>(() => toDraftRows(initialPeople));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Reset from server only when `syncKey` changes (e.g. `updated_at`), not when parent re-renders with a new array reference.
  useEffect(() => {
    setDraft(toDraftRows(initialPeople));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: avoid resetting draft on every table render
  }, [syncKey]);

  const count = draft.filter(rowHasData).length;

  function patchRow(index: number, patch: Partial<PipelinePersonDraft>) {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
    setDirty(true);
  }

  function addPerson() {
    setDraft((prev) => [...prev, { name: "", email: "", linkedin_url: "" }]);
    setDirty(true);
  }

  function removeRow(index: number) {
    const row = draft[index];
    if (rowHasData(row)) {
      if (!window.confirm("Remove this person from the list?")) return;
    }
    setDraft((prev) =>
      prev.length <= 1 ? [{ name: "", email: "", linkedin_url: "" }] : prev.filter((_, i) => i !== index)
    );
    setDirty(true);
  }

  async function handleSave() {
    const payload = buildPeopleSavePayload(draft, legacyContactEmails);
    setSaving(true);
    try {
      const ok = await onSave(payload);
      if (ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="group min-w-[260px] max-w-[420px] rounded-md border border-white/15 bg-[#1A211D] open:bg-[#1D2621]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-[#ECE7DF]">
        <span>
          People ({count}
          {dirty ? ", unsaved" : ""})
        </span>
        <span className="select-none text-[#8E877A]" aria-hidden>
          ▼
        </span>
      </summary>
      <div className="space-y-2 border-t border-white/10 p-2">
        {draft.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-1 items-start gap-1 text-xs sm:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <input
              value={row.name}
              onChange={(e) => patchRow(index, { name: e.target.value })}
              className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="Name"
              disabled={disabled}
            />
            <input
              type="email"
              value={row.email}
              onChange={(e) => patchRow(index, { email: e.target.value })}
              className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="Email"
              disabled={disabled}
            />
            <input
              value={row.linkedin_url}
              onChange={(e) => patchRow(index, { linkedin_url: e.target.value })}
              className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-[#ECE7DF] placeholder:text-[#8E877A]"
              placeholder="LinkedIn URL"
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => removeRow(index)}
              disabled={disabled}
              className="shrink-0 rounded px-2 py-1 text-xs text-[#F1A2A2] hover:bg-[#3A1E1E]"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={addPerson}
            disabled={disabled}
            className="rounded border border-white/15 bg-[#151A17] px-2 py-1 text-xs text-[#D7D0C4] hover:bg-white/5"
          >
            Add person
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={disabled || saving || !dirty}
            className="rounded bg-[#2E7040] px-2 py-1 text-xs text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save people"}
          </button>
        </div>
        <p className="text-[10px] text-[#9E978B]">
          Emails in each row merge into the People Emails column when you save (including any emails only on that list).
        </p>
      </div>
    </details>
  );
}
