"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import { GENERAL_ATHLETE_ID, GENERAL_ATHLETE_NAME } from "@/lib/crm/pipeline-card-filter-sort";
import { cn } from "@/lib/utils";

export type AssignedAthlete = {
  athlete_id: string;
  name?: string;
  sport?: string | null;
  match_score?: number | null;
};

type SearchHit = { athlete_id: string; name: string; sport?: string | null };

export function PotentialAthletesAssign({
  athletes,
  disabled,
  busy,
  compact = false,
  onChange,
  onOpenChange,
}: {
  athletes: AssignedAthlete[];
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  onChange: (next: AssignedAthlete[]) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);

  const setPickerOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
    if (!next) setQ("");
  };

  useEffect(() => {
    if (!open) return;
    if (!q.trim() || q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const pattern = `%${normalizeOrIlikeFragment(q)}%`;
      const { data } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name, sport")
        .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
        .limit(15);
      setResults(
        (data ?? []).map((a) => ({
          athlete_id: String(a.athlete_id),
          name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || "Athlete",
          sport: a.sport != null ? String(a.sport) : null,
        }))
      );
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  const list = athletes ?? [];
  const hasGeneral = list.some((x) => x.athlete_id === GENERAL_ATHLETE_ID);
  const locked = disabled || busy;

  const addAthlete = (a: SearchHit, replace = false) => {
    if (list.some((x) => x.athlete_id === a.athlete_id)) {
      setPickerOpen(false);
      return;
    }
    const entry: AssignedAthlete = {
      athlete_id: a.athlete_id,
      name: a.name,
      sport: a.sport ?? null,
    };
    onChange(replace ? [entry] : [...list, entry]);
    setPickerOpen(false);
  };

  const addGeneral = (replace = false) => {
    if (hasGeneral && !replace) return;
    const entry: AssignedAthlete = {
      athlete_id: GENERAL_ATHLETE_ID,
      name: GENERAL_ATHLETE_NAME,
    };
    onChange(replace ? [entry] : [...list, entry]);
    setPickerOpen(false);
  };

  const removeAthlete = (athlete_id: string) => {
    onChange(list.filter((x) => x.athlete_id !== athlete_id));
  };

  const replaceMode = list.length <= 1;

  return (
    <div className={cn("relative", compact ? "mt-0.5" : "")}>
      <div className={cn("flex flex-wrap items-center gap-1", compact ? "" : "mb-2")}>
        {list.map((a) => (
          <span
            key={a.athlete_id}
            className={cn(
              "inline-flex items-center gap-1 rounded border border-white/15 bg-[#1A211D] text-[#ECE7DF]",
              compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-sm"
            )}
          >
            <span>{a.name?.trim() || "Athlete"}</span>
            <button
              type="button"
              disabled={locked}
              className="text-[#F1A2A2] hover:text-[#F8C5C5] disabled:opacity-50"
              title="Remove athlete"
              onClick={() => removeAthlete(a.athlete_id)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={locked}
          className={cn(
            "text-[#CEE4D4] hover:text-[#E8F6ED] disabled:opacity-50",
            compact ? "text-[10px]" : "text-sm"
          )}
          onClick={() => setPickerOpen(!open)}
        >
          {list.length === 0 ? "+ Assign athlete" : replaceMode ? "Change" : "+ Add"}
        </button>
      </div>

      {open && (
        <div
          className={cn(
            "z-40 space-y-2 rounded-md border border-white/15 bg-[#171D1A] p-2 shadow-xl",
            compact ? "absolute left-0 top-full mt-1 w-64" : "mt-2"
          )}
        >
          {list.length > 0 && (
            <p className="px-1 text-[11px] text-[#8E877A]">
              {replaceMode
                ? "Picking an athlete replaces the current assignment."
                : "Add another athlete, or remove a chip above."}
            </p>
          )}
          <button
            type="button"
            className="w-full rounded border border-dashed border-white/15 px-2 py-1 text-left text-sm text-[#CEE4D4] hover:bg-white/5 disabled:opacity-50"
            onClick={() => addGeneral(replaceMode && list.length === 1)}
            disabled={locked || (hasGeneral && !(replaceMode && list.length === 1))}
          >
            {replaceMode && list.length === 1 ? "Assign as General" : "+ Assign as General"}
          </button>
          <input
            className="w-full rounded border border-white/15 bg-[#101513] px-2 py-1 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
            placeholder="Search athletes…"
            value={q}
            autoFocus
            disabled={locked}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {results.map((a) => (
              <button
                key={a.athlete_id}
                type="button"
                disabled={locked}
                className="w-full rounded px-2 py-1 text-left text-sm text-[#ECE7DF] hover:bg-white/5 disabled:opacity-50"
                onClick={() => addAthlete(a, replaceMode && list.length === 1)}
              >
                {a.name}
                {a.sport ? <span className="ml-1 text-[10px] text-[#8E877A]">{a.sport}</span> : null}
              </button>
            ))}
            {q.trim().length >= 2 && results.length === 0 && (
              <p className="px-1 py-1 text-[11px] text-[#8E877A]">No matches.</p>
            )}
          </div>
          <button
            type="button"
            className="text-[10px] text-[#8E877A] underline"
            onClick={() => setPickerOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
