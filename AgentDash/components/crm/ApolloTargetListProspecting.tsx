"use client";

import { useEffect, useState } from "react";
import {
  loadApolloRevenueFilterPrefs,
  saveApolloRevenueFilterPrefs,
  type ApolloRevenueFilterPrefs,
} from "@/lib/apollo/prospecting-prefs";

type SimilarOrg = {
  name: string;
  website?: string;
  industry?: string;
  description?: string;
  apollo_organization_id?: string | null;
};

type ExpandGroup = {
  seed_company_name: string;
  similar: SimilarOrg[];
};

type Props = {
  athleteId: string;
  selectedCompanyIds: string[];
  disabled?: boolean;
  onError?: (message: string) => void;
  onPrefsChange?: (prefs: ApolloRevenueFilterPrefs) => void;
};

export function ApolloTargetListProspecting({
  athleteId,
  selectedCompanyIds,
  disabled,
  onError,
  onPrefsChange,
}: Props) {
  const [prefs, setPrefs] = useState<ApolloRevenueFilterPrefs>({});
  const [expanding, setExpanding] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const [expandGroups, setExpandGroups] = useState<ExpandGroup[]>([]);

  useEffect(() => {
    setPrefs(loadApolloRevenueFilterPrefs());
  }, []);

  function updatePrefs(next: ApolloRevenueFilterPrefs) {
    setPrefs(next);
    saveApolloRevenueFilterPrefs(next);
    onPrefsChange?.(next);
  }

  async function handleExpandSimilar() {
    if (selectedCompanyIds.length === 0) {
      onError?.("Select at least one company (checkbox in Company column).");
      return;
    }
    setExpanding(true);
    onError?.("");
    try {
      const body: Record<string, unknown> = {
        seed_company_ids: selectedCompanyIds.slice(0, 3),
        athlete_id: athleteId,
        limit_per_seed: 5,
      };
      const min = prefs.revenue_min?.trim() ? Number(prefs.revenue_min.replace(/,/g, "")) : undefined;
      const max = prefs.revenue_max?.trim() ? Number(prefs.revenue_max.replace(/,/g, "")) : undefined;
      if (min != null && Number.isFinite(min)) body.revenue_range = { min };
      if (max != null && Number.isFinite(max)) {
        body.revenue_range = { ...(body.revenue_range as object), max };
      }
      const locs = prefs.organization_locations
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (locs?.length) body.organization_locations = locs;

      const res = await fetch("/api/apollo/companies/expand-similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Expand similar failed");
      const groups: ExpandGroup[] = (Array.isArray(data.groups) ? data.groups : []).map(
        (g: { seed?: { company_name?: string }; similar?: SimilarOrg[] }) => ({
          seed_company_name: g.seed?.company_name ?? "Seed",
          similar: Array.isArray(g.similar) ? g.similar : [],
        })
      );
      setExpandGroups(groups);
      setExpandOpen(true);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Expand similar failed");
    } finally {
      setExpanding(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-[#2E7040]/30 bg-[#121713] px-2 py-1.5">
        <label className="flex flex-col gap-0.5 text-[10px] text-[#AEA79A]">
          Rev min ($)
          <input
            type="text"
            inputMode="numeric"
            className="w-24 rounded border border-white/10 bg-[#0E100F] px-1.5 py-0.5 text-[11px] text-[#E6E0D5]"
            value={prefs.revenue_min ?? ""}
            disabled={disabled}
            onChange={(e) => updatePrefs({ ...prefs, revenue_min: e.target.value })}
            placeholder="1000000"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-[#AEA79A]">
          Rev max ($)
          <input
            type="text"
            inputMode="numeric"
            className="w-24 rounded border border-white/10 bg-[#0E100F] px-1.5 py-0.5 text-[11px] text-[#E6E0D5]"
            value={prefs.revenue_max ?? ""}
            disabled={disabled}
            onChange={(e) => updatePrefs({ ...prefs, revenue_max: e.target.value })}
            placeholder="50000000"
          />
        </label>
        <label className="flex min-w-[140px] flex-col gap-0.5 text-[10px] text-[#AEA79A]">
          HQ locations
          <input
            type="text"
            className="rounded border border-white/10 bg-[#0E100F] px-1.5 py-0.5 text-[11px] text-[#E6E0D5]"
            value={prefs.organization_locations ?? ""}
            disabled={disabled}
            onChange={(e) => updatePrefs({ ...prefs, organization_locations: e.target.value })}
            placeholder="california, united states"
          />
        </label>
        <button
          type="button"
          disabled={disabled || expanding || selectedCompanyIds.length === 0}
          title="Find similar companies via Apollo (uses org search credits). Select up to 3 companies."
          onClick={() => void handleExpandSimilar()}
          className="rounded-md border border-[#6B5A2E]/60 bg-[#2A2618] px-3 py-1.5 text-xs font-medium text-[#E8D9A8] hover:bg-[#35301F] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {expanding ? "Expanding…" : `Expand similar (${selectedCompanyIds.length})`}
        </button>
      </div>

      {expandOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[#2E7040]/40 bg-[#1B2F21] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-[#DBEEE0]">Similar companies (Apollo)</h3>
              <button
                type="button"
                className="text-xs text-[#AEA79A] hover:text-[#E6E0D5]"
                onClick={() => setExpandOpen(false)}
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-[10px] text-[#AEA79A]">
              Filter-based lookalikes from industry, size, and revenue. Add winners via Mystery Machine or CRM.
            </p>
            {expandGroups.length === 0 ? (
              <p className="text-xs text-[#B9B2A6]">No similar companies found.</p>
            ) : (
              <div className="space-y-4">
                {expandGroups.map((g) => (
                  <div key={g.seed_company_name}>
                    <p className="mb-1 text-xs font-medium text-[#E8D9A8]">Similar to {g.seed_company_name}</p>
                    <ul className="space-y-1 text-xs text-[#D7D0C4]">
                      {g.similar.length === 0 ? (
                        <li className="text-[#AEA79A]">No matches</li>
                      ) : (
                        g.similar.map((s) => (
                          <li key={`${g.seed_company_name}-${s.name}`}>
                            <span className="font-medium text-[#DBEEE0]">{s.name}</span>
                            {s.website ? (
                              <span className="text-[#AEA79A]"> — {s.website.replace(/^https?:\/\//i, "")}</span>
                            ) : null}
                            {s.industry ? (
                              <span className="block text-[10px] text-[#AEA79A]">{s.industry}</span>
                            ) : null}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
