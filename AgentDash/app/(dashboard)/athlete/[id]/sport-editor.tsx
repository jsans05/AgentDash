"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAthleteTaxonomySport } from "@/lib/taxonomy-constants";

type TaxonomyNode = {
  sport: string;
};

type Props = {
  athleteId: string;
  initialSport: string | null;
  canEdit: boolean;
};

export function SportEditor({ athleteId, initialSport, canEdit }: Props) {
  const router = useRouter();
  const [sportInput, setSportInput] = useState(initialSport ?? "");
  const [sports, setSports] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSportInput(initialSport ?? "");
  }, [initialSport]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/taxonomy/nodes", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        const uniqueSports = Array.from(
          new Set(
            list
              .map((n: TaxonomyNode) => String(n?.sport ?? "").trim())
              .filter((s) => s && isAthleteTaxonomySport(s))
          )
        ).sort((a, b) => a.localeCompare(b));
        setSports(uniqueSports);
      })
      .catch(() => {
        if (!cancelled) setSports([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasChanged = useMemo(() => {
    return (initialSport ?? "").trim() !== sportInput.trim();
  }, [initialSport, sportInput]);

  async function onSave() {
    if (!canEdit || !hasChanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/sport`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sport: sportInput }),
      });
      const data = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) {
        throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save sport";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-sm font-medium text-[#B9B2A6]">Sport</dt>
      <dd className="mt-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={sportInput}
            onChange={(e) => setSportInput(e.target.value)}
            disabled={!canEdit || saving}
            list="taxonomy-sport-options"
            placeholder="Enter sport"
            className="w-full max-w-md rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          />
          <datalist id="taxonomy-sport-options">
            {sports.map((sport) => (
              <option key={sport} value={sport} />
            ))}
          </datalist>
          {canEdit && (
            <button
              type="button"
              onClick={onSave}
              disabled={!hasChanged || saving}
              className="rounded-md bg-[#2E7040] px-3 py-2 text-sm font-medium text-white hover:bg-[#285F36] disabled:cursor-not-allowed disabled:bg-[#3B4D43]"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-[#F1A2A2]">{error}</p>}
      </dd>
    </div>
  );
}
