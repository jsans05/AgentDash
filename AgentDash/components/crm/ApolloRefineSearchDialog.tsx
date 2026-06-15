"use client";

import { useEffect, useState } from "react";
import {
  APOLLO_DEFAULT_PERSON_SENIORITIES,
  APOLLO_DEFAULT_PERSON_TITLES,
  formatApolloPartnershipSearchSummary,
} from "@/lib/apollo/search-defaults";
import {
  parseRevenueFilterBody,
  type ApolloRevenueFilterPrefs,
} from "@/lib/apollo/prospecting-prefs";
import { formatApolloRefineSearchSummary } from "@/lib/apollo/search-defaults";

type ApolloRefineSearchDialogProps = {
  open: boolean;
  prefs: ApolloRevenueFilterPrefs;
  onClose: () => void;
  onSave: (prefs: ApolloRevenueFilterPrefs) => void;
};

const defaultTitles = APOLLO_DEFAULT_PERSON_TITLES.join(", ");
const defaultSeniorities = APOLLO_DEFAULT_PERSON_SENIORITIES.map((s) => s.replace(/_/g, " ")).join(
  ", "
);

export function ApolloRefineSearchDialog({
  open,
  prefs,
  onClose,
  onSave,
}: ApolloRefineSearchDialogProps) {
  const [draft, setDraft] = useState<ApolloRevenueFilterPrefs>(prefs);

  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  if (!open) return null;

  const activeSummary = formatApolloRefineSearchSummary(parseRevenueFilterBody(draft));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apollo-refine-search-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="apollo-refine-search-title" className="text-sm font-semibold text-[#DBEEE0]">
          Refine Apollo search
        </h2>
        <p className="mt-1 text-xs text-[#AEA79A]">
          Narrow contact search for Find contacts. Leave job titles empty to use default partnership
          filters ({defaultTitles}).
        </p>

        <div className="mt-3 space-y-3">
          <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
            Job titles
            <input
              type="text"
              className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
              value={draft.person_titles ?? ""}
              placeholder={defaultTitles}
              onChange={(e) => setDraft({ ...draft, person_titles: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
            Contact country / region
            <input
              type="text"
              className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
              value={draft.person_locations ?? ""}
              placeholder="united states, california"
              onChange={(e) => setDraft({ ...draft, person_locations: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
            Company HQ locations
            <input
              type="text"
              className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
              value={draft.organization_locations ?? ""}
              placeholder="california, united states"
              onChange={(e) => setDraft({ ...draft, organization_locations: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
            Seniority
            <input
              type="text"
              className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
              value={draft.person_seniorities ?? ""}
              placeholder={defaultSeniorities}
              onChange={(e) => setDraft({ ...draft, person_seniorities: e.target.value })}
            />
            <span className="text-[9px] text-[#8A8478]">
              Apollo values: owner, founder, c_suite, vp, head, director, manager
            </span>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
            Keywords
            <input
              type="text"
              className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
              value={draft.q_keywords ?? ""}
              placeholder="influencer, sponsorship"
              onChange={(e) => setDraft({ ...draft, q_keywords: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
              Rev min ($)
              <input
                type="text"
                inputMode="numeric"
                className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
                value={draft.revenue_min ?? ""}
                placeholder="1000000"
                onChange={(e) => setDraft({ ...draft, revenue_min: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-[#AEA79A]">
              Rev max ($)
              <input
                type="text"
                inputMode="numeric"
                className="rounded border border-white/10 bg-[#0E100F] px-2 py-1 text-[11px] text-[#E6E0D5]"
                value={draft.revenue_max ?? ""}
                placeholder="50000000"
                onChange={(e) => setDraft({ ...draft, revenue_max: e.target.value })}
              />
            </label>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-[#8A8478]" title={formatApolloPartnershipSearchSummary()}>
          Verified email only. Re-run Find contacts after saving.
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded border border-white/15 px-3 py-1 text-xs text-[#DBEEE0] hover:bg-white/5"
            onClick={() => {
              const cleared: ApolloRevenueFilterPrefs = {};
              setDraft(cleared);
              onSave(cleared);
              onClose();
            }}
          >
            Clear filters
          </button>
          <button
            type="button"
            className="rounded border border-white/15 px-3 py-1 text-xs text-[#DBEEE0] hover:bg-white/5"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-3 py-1 text-xs font-medium text-[#DBEEE0] hover:bg-[#23452E]"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save &amp; apply
          </button>
        </div>

        {activeSummary ? (
          <p className="mt-2 text-[10px] text-[#9FD4A8]">Preview: {activeSummary}</p>
        ) : null}
      </div>
    </div>
  );
}
