"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  athleteId: string;
  initialFirstName: string;
  initialLastName: string;
  initialAliases: string[];
  canEdit: boolean;
};

export function NameEditor({
  athleteId,
  initialFirstName,
  initialLastName,
  initialAliases,
  canEdit,
}: Props) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [aliases, setAliases] = useState<string[]>(initialAliases);
  const [aliasDraft, setAliasDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(initialFirstName);
    setLastName(initialLastName);
    setAliases(initialAliases);
  }, [initialFirstName, initialLastName, initialAliases]);

  const hasChanged = useMemo(() => {
    const a = [...aliases].map((s) => s.trim().toLowerCase()).sort().join("|");
    const b = [...initialAliases].map((s) => s.trim().toLowerCase()).sort().join("|");
    return (
      firstName.trim() !== initialFirstName.trim() ||
      lastName.trim() !== initialLastName.trim() ||
      a !== b
    );
  }, [firstName, lastName, aliases, initialFirstName, initialLastName, initialAliases]);

  function addAlias() {
    const s = aliasDraft.trim();
    if (!s) return;
    if (aliases.some((a) => a.toLowerCase() === s.toLowerCase())) {
      setAliasDraft("");
      return;
    }
    setAliases((prev) => [...prev, s]);
    setAliasDraft("");
  }

  function removeAlias(value: string) {
    setAliases((prev) => prev.filter((a) => a !== value));
  }

  async function onSave() {
    if (!canEdit || !hasChanged || saving) return;
    if (!firstName.trim()) {
      setError("First name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name_aliases: aliases,
        }),
      });
      const data = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) {
        throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sm:col-span-2">
      <dt className="text-sm font-medium text-[#B9B2A6]">Name &amp; import aliases</dt>
      <dd className="mt-1 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="First name"
            className="w-full max-w-[12rem] rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="Last name"
            className="w-full max-w-[12rem] rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          />
          {canEdit && (
            <button
              type="button"
              onClick={onSave}
              disabled={!hasChanged || saving}
              className="rounded-md bg-[#2E7040] px-3 py-2 text-sm font-medium text-white hover:bg-[#285F36] disabled:cursor-not-allowed disabled:bg-[#3B4D43]"
            >
              {saving ? "Saving..." : "Save name"}
            </button>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs text-[#8E877A]">
            Aliases match Metabase / import names (e.g. Caity Simmers for Caitlin Simmers).
          </p>
          {aliases.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {aliases.map((a) => (
                <li
                  key={a}
                  className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-[#101513] px-2 py-1 text-xs text-[#D7D0C4]"
                >
                  {a}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeAlias(a)}
                      className="text-[#F1A2A2] hover:text-[#FFD2D2]"
                      aria-label={`Remove alias ${a}`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                disabled={saving}
                placeholder="Add alias…"
                className="w-full max-w-xs rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
              />
              <button
                type="button"
                onClick={addAlias}
                disabled={!aliasDraft.trim() || saving}
                className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] hover:bg-[#1A211D] disabled:opacity-50"
              >
                Add alias
              </button>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-[#F1A2A2]">{error}</p>}
      </dd>
    </div>
  );
}
