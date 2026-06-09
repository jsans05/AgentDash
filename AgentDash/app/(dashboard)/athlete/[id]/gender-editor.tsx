"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ATHLETE_GENDER_OPTIONS,
  formatAthleteGender,
  type AthleteGender,
} from "@/lib/athletes/gender";

type Props = {
  athleteId: string;
  initialGender: AthleteGender | null;
  canEdit: boolean;
};

export function GenderEditor({ athleteId, initialGender, canEdit }: Props) {
  const router = useRouter();
  const [gender, setGender] = useState<AthleteGender | "">(initialGender ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGender(initialGender ?? "");
  }, [initialGender]);

  const hasChanged = useMemo(() => {
    return (initialGender ?? "") !== (gender || "");
  }, [initialGender, gender]);

  async function onSave() {
    if (!canEdit || !hasChanged || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/gender`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ gender: gender || null }),
      });
      const data = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) {
        throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save gender";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-sm font-medium text-[#B9B2A6]">Gender</dt>
      <dd className="mt-1">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as AthleteGender | "")}
              disabled={saving}
              className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
            >
              <option value="">Not set</option>
              {ATHLETE_GENDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onSave}
              disabled={!hasChanged || saving}
              className="rounded-md bg-[#2E7040] px-3 py-2 text-sm font-medium text-white hover:bg-[#285F36] disabled:cursor-not-allowed disabled:bg-[#3B4D43]"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        ) : (
          <span className="text-sm text-[#ECE7DF]">
            {formatAthleteGender(initialGender) ?? "Not set"}
          </span>
        )}
        {error && <p className="mt-2 text-sm text-[#F1A2A2]">{error}</p>}
      </dd>
    </div>
  );
}
