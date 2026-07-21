"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Teammate = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string;
};

export type AssignResult = {
  transferred: string[];
  already_had: string[];
  assignee: { user_id: string; name: string };
};

function teammateDisplayName(t: Teammate): string {
  const name = [t.first_name, t.last_name].filter(Boolean).join(" ").trim();
  return name || t.email || "Unknown";
}

type Props = {
  pipelineIds: string[];
  /** When set, only sales + agents on these athletes appear / are accepted. */
  athleteIds?: string[];
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  onAssigned?: (result: AssignResult) => void;
};

export function AssignToTeammateMenu({
  pipelineIds,
  athleteIds,
  disabled,
  className,
  buttonClassName,
  onAssigned,
}: Props) {
  const [open, setOpen] = useState(false);
  const [teammates, setTeammates] = useState<Teammate[] | null>(null);
  const [loadingTeammates, setLoadingTeammates] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const scopedAthleteKey = (athleteIds ?? []).slice().sort().join(",");

  const count = pipelineIds.length;

  const updateMenuPos = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - menuWidth - 8
    );
    setMenuPos({ top: rect.bottom + 4, left });
  }, []);

  useEffect(() => {
    setTeammates(null);
    setLoadError(null);
  }, [scopedAthleteKey]);

  const loadTeammates = useCallback(async () => {
    if (teammates != null || loadingTeammates) return;
    setLoadingTeammates(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      for (const id of athleteIds ?? []) {
        if (id) params.append("athlete_id", id);
      }
      const qs = params.toString();
      const res = await fetch(`/api/teammates${qs ? `?${qs}` : ""}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data?.error ?? "Failed to load teammates");
        setTeammates([]);
        return;
      }
      setTeammates(Array.isArray(data.teammates) ? data.teammates : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load teammates");
      setTeammates([]);
    } finally {
      setLoadingTeammates(false);
    }
  }, [teammates, loadingTeammates, athleteIds]);

  useEffect(() => {
    if (open) void loadTeammates();
  }, [open, loadTeammates]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    function onReposition() {
      updateMenuPos();
    }
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPos]);

  async function assignTo(teammate: Teammate) {
    if (count === 0 || assigning) return;
    const name = teammateDisplayName(teammate);
    const confirmed = window.confirm(
      `Send ${count} brand${count === 1 ? "" : "s"} to ${name}? They will leave your pipeline and appear on theirs at Target stage.`
    );
    if (!confirmed) return;

    setAssigning(true);
    try {
      const res = await fetch("/api/crm/pipeline/batch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_ids: pipelineIds,
          assignee_user_id: teammate.user_id,
          athlete_ids: athleteIds ?? [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error ?? "Assignment failed");
        return;
      }

      const transferred: string[] = Array.isArray(data.transferred) ? data.transferred : [];
      const alreadyHad: string[] = Array.isArray(data.already_had) ? data.already_had : [];
      const assigneeName = String(data?.assignee?.name ?? name);
      const parts: string[] = [];
      if (transferred.length > 0) {
        parts.push(`Assigned ${transferred.length} to ${assigneeName}`);
      }
      if (alreadyHad.length > 0) {
        parts.push(
          `${alreadyHad.length} already in their pipeline (removed from yours)`
        );
      }
      alert(parts.join(". ") || "Done");

      setOpen(false);
      onAssigned?.({
        transferred,
        already_had: alreadyHad,
        assignee: {
          user_id: String(data?.assignee?.user_id ?? teammate.user_id),
          name: assigneeName,
        },
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  if (count === 0) return null;

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[100] cursor-default"
              aria-label="Close assignee menu"
              onClick={() => setOpen(false)}
            />
            <div
              role="listbox"
              className="fixed z-[110] max-h-64 min-w-[220px] overflow-y-auto rounded-md border border-white/15 bg-[#151A17] py-1 shadow-xl"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              {loadingTeammates && (
                <div className="px-3 py-2 text-xs text-[#B9B2A6]">Loading teammates…</div>
              )}
              {loadError && (
                <div className="px-3 py-2 text-xs text-red-300">{loadError}</div>
              )}
              {!loadingTeammates && teammates && teammates.length === 0 && !loadError && (
                <div className="px-3 py-2 text-xs text-[#B9B2A6]">
                  {athleteIds && athleteIds.length > 0
                    ? "No sales users or agents for this athlete"
                    : "No teammates found"}
                </div>
              )}
              {(teammates ?? []).map((t) => (
                <button
                  key={t.user_id}
                  type="button"
                  role="option"
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/10"
                  disabled={assigning}
                  onClick={() => void assignTo(t)}
                >
                  <span className="font-medium">{teammateDisplayName(t)}</span>
                  <span className="text-[11px] capitalize text-[#8E877A]">{t.role}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div className={cn("relative inline-flex", className)}>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-8 text-xs", buttonClassName)}
        disabled={disabled || assigning}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {assigning ? "Assigning…" : "Assign to…"}
      </Button>
      {menu}
    </div>
  );
}
