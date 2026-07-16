"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { normalizeOrIlikeFragment } from "@/lib/supabase/ilike";
import { cn } from "@/lib/utils";

type AthleteOption = {
  athlete_id: string;
  name: string;
};

type CrmBrandIdeaQuickAddProps = {
  /** Called after a successful add (e.g. refetch client-side pipeline data). `router.refresh()` still runs. */
  onSuccess?: () => void;
  /** Called after successful submit or when user cancels (modal layout). */
  onClose?: () => void;
  /** `modal` stacks fields vertically for dialog use. */
  layout?: "inline" | "modal";
};

export function CrmBrandIdeaQuickAdd({
  onSuccess,
  onClose,
  layout = "inline",
}: CrmBrandIdeaQuickAddProps = {}) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [notes, setNotes] = useState("");
  const [athleteQuery, setAthleteQuery] = useState("");
  const [athleteResults, setAthleteResults] = useState<AthleteOption[]>([]);
  const [selectedAthlete, setSelectedAthlete] = useState<AthleteOption | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchingAthletes, setSearchingAthletes] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = athleteQuery.trim();
    if (!searchOpen || selectedAthlete || q.length < 2) {
      setAthleteResults([]);
      return;
    }

    const t = setTimeout(async () => {
      setSearchingAthletes(true);
      try {
        const orPattern = `%${normalizeOrIlikeFragment(q)}%`;
        const { data } = await supabase
          .from("athletes")
          .select("athlete_id, first_name, last_name")
          .or(`first_name.ilike.${orPattern},last_name.ilike.${orPattern}`)
          .limit(12);

        const rows: AthleteOption[] = (data ?? [])
          .map((a) => ({
            athlete_id: a.athlete_id,
            name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
          }))
          .filter((a) => a.name.length > 0);
        setAthleteResults(rows);
      } finally {
        setSearchingAthletes(false);
      }
    }, 220);

    return () => clearTimeout(t);
  }, [athleteQuery, searchOpen, selectedAthlete]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = companyName.trim();
    if (!name) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/crm/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          company_name: name,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to add brand idea");
        return;
      }

      const pipelineRowId = String(data?.company?.id ?? "").trim();
      if (selectedAthlete && pipelineRowId) {
        const patchRes = await fetch(`/api/crm/pipeline/${pipelineRowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            potential_athletes: [
              {
                athlete_id: selectedAthlete.athlete_id,
                name: selectedAthlete.name,
              },
            ],
          }),
        });
        const patchData = await patchRes.json().catch(() => ({}));
        if (!patchRes.ok) {
          alert(patchData.error || "Company added, but failed to set potential athlete");
          return;
        }
      }

      setCompanyName("");
      setNotes("");
      setAthleteQuery("");
      setAthleteResults([]);
      setSelectedAthlete(null);
      setSearchOpen(false);
      router.refresh();
      onSuccess?.();
      onClose?.();
    } finally {
      setSubmitting(false);
    }
  }

  const isModal = layout === "modal";

  return (
    <form
      onSubmit={onSubmit}
      className={isModal ? "flex flex-col gap-4" : "flex flex-wrap items-end gap-3"}
    >
      <label className={cn("flex flex-col gap-1 text-sm", isModal && "w-full")}>
        <span className="text-[#D7D0C4]">Company Name</span>
        <input
          required
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className={cn(
            "rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]",
            isModal ? "w-full" : "min-w-[220px]"
          )}
          placeholder="Nike"
          autoFocus={isModal}
        />
      </label>
      <label className={cn("flex flex-col gap-1 text-sm", isModal ? "w-full" : "min-w-[260px]")}>
        <span className="text-[#D7D0C4]">Potential Athlete</span>
        <div className={cn("relative", isModal ? "w-full" : "min-w-[260px]")}>
          {selectedAthlete ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]">
              <span className="truncate">{selectedAthlete.name}</span>
              <button
                type="button"
                aria-label="Clear potential athlete"
                className="shrink-0 text-sm leading-none text-[#B9B2A6] hover:text-[#ECE7DF]"
                onClick={() => {
                  setSelectedAthlete(null);
                  setAthleteQuery("");
                  setAthleteResults([]);
                  setSearchOpen(true);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <>
              <input
                value={athleteQuery}
                onChange={(e) => {
                  setAthleteQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                className="w-full rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
                placeholder="Search athlete..."
              />
              {searchOpen && athleteQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-white/15 bg-[#171D1A] py-1 shadow-xl">
                  {searchingAthletes ? (
                    <div className="px-3 py-2 text-xs text-[#B9B2A6]">Searching...</div>
                  ) : athleteResults.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#B9B2A6]">No athletes found</div>
                  ) : (
                    athleteResults.map((athlete) => (
                      <button
                        key={athlete.athlete_id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/5"
                        onClick={() => {
                          setSelectedAthlete(athlete);
                          setAthleteResults([]);
                          setAthleteQuery("");
                          setSearchOpen(false);
                        }}
                      >
                        {athlete.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </label>
      <label className={cn("flex flex-col gap-1 text-sm", isModal ? "w-full" : "min-w-[260px]")}>
        <span className="text-[#D7D0C4]">Notes</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={cn(
            "rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]",
            isModal && "w-full"
          )}
          placeholder="Creator fit, campaign angle, etc."
        />
      </label>
      <div className={cn("flex gap-2", isModal ? "justify-end pt-1" : "")}>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/15 px-4 py-2 text-sm text-[#D7D0C4] hover:bg-white/5"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || !companyName.trim()}
          className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36] disabled:opacity-50"
        >
          {submitting ? "Adding..." : "Add idea"}
        </button>
      </div>
    </form>
  );
}
