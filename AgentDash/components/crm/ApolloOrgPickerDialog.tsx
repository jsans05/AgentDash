"use client";

import { useCallback, useEffect, useState } from "react";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";

type OrgCandidate = {
  apollo_organization_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  description: string | null;
  score: number;
  primary_domain: string | null;
  match_confidence: "high" | "medium" | "low";
  selected: boolean;
};

type OrgCandidatesResponse = {
  current?: {
    apollo_organization_id: string;
    apollo_organization_name: string;
    domain: string | null;
    match_confidence: string;
  } | null;
  candidates?: OrgCandidate[];
  company_name?: string;
  brand_name?: string;
  error?: string;
};

type ApolloOrgPickerDialogProps = {
  open: boolean;
  companyId?: string;
  brandKey?: string;
  companyName?: string;
  onClose: () => void;
  onSelected: (payload: {
    apollo_organization_id: string;
    apollo_organization_name: string;
    match_notes?: string;
    pending_contacts_cleared?: number;
  }) => void;
};

function confidenceBadge(conf: string) {
  if (conf === "high") return "text-[#9FD4A8] border-[#2E7040]/50";
  if (conf === "medium") return "text-[#E8D9A8] border-[#6B5A2E]/50";
  return "text-[#D4A8A8] border-[#6B3A3A]/50";
}

export function ApolloOrgPickerDialog({
  open,
  companyId,
  brandKey,
  companyName,
  onClose,
  onSelected,
}: ApolloOrgPickerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OrgCandidatesResponse | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = brandKey
        ? `/api/market-intel/brands/org-candidates?brand_key=${encodeURIComponent(brandKey)}`
        : `/api/apollo/companies/${companyId}/org-candidates`;
      const res = await fetch(url, { credentials: "include" });
      const json = (await res.json().catch(() => ({}))) as OrgCandidatesResponse;
      if (!res.ok) throw new Error(json.error || `Failed to load organizations (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load organizations");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [brandKey, companyId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function applySelection(apollo_organization_id: string) {
    setSelectingId(apollo_organization_id);
    setError(null);
    try {
      if (brandKey) {
        const res = await fetch("/api/market-intel/brands/select-organization", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ brand_key: brandKey, apollo_organization_id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Failed to update brand (${res.status})`);
        onSelected({
          apollo_organization_id,
          apollo_organization_name: json.organization?.match_notes?.replace(/^Using Apollo org "/, "").split('"')[0] ?? "",
          match_notes: json.organization?.match_notes,
        });
      } else if (companyId) {
        const res = await fetch(`/api/apollo/companies/${companyId}/select-organization`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ apollo_organization_id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Failed to update company (${res.status})`);
        onSelected({
          apollo_organization_id,
          apollo_organization_name: json.organization?.apollo_organization_name ?? "",
          match_notes: json.organization?.match_notes,
          pending_contacts_cleared: json.pending_contacts_cleared ?? 0,
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update organization");
    } finally {
      setSelectingId(null);
      setConfirmId(null);
    }
  }

  const label = companyName || data?.brand_name || data?.company_name || "this company";
  const confirmCandidate = data?.candidates?.find((c) => c.apollo_organization_id === confirmId);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="presentation"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-sm font-semibold text-[#DBEEE0]">Choose Apollo company</h2>
          <p className="mt-1 text-xs text-[#AEA79A]">
            Pick the correct organization for {label}.
            {companyId ? " Pending Apollo contacts from a wrong match will be removed." : null}
          </p>

          {loading ? <p className="mt-4 text-xs text-[#B9B2A6]">Loading Apollo matches…</p> : null}
          {error ? <p className="mt-3 text-xs text-[#E8A8A8]">{error}</p> : null}

          {!loading && data?.candidates?.length ? (
            <ul className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {data.candidates.map((c) => {
                const domain = c.primary_domain || c.website?.replace(/^https?:\/\//i, "").split("/")[0];
                const isCurrent = c.selected;
                return (
                  <li
                    key={c.apollo_organization_id}
                    className={`rounded-lg border p-2.5 ${
                      isCurrent
                        ? "border-[#2E7040]/60 bg-[#1B2F21]"
                        : "border-white/10 bg-[#1A1D1B]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-[#DBEEE0]">
                          {c.name}
                          {isCurrent ? (
                            <span className="ml-1.5 text-[10px] font-normal text-[#9FD4A8]">
                              (current)
                            </span>
                          ) : null}
                        </p>
                        {domain ? (
                          <p className="truncate text-[10px] text-[#AEA79A]">{domain}</p>
                        ) : null}
                        {c.industry ? (
                          <p className="mt-0.5 line-clamp-2 text-[10px] text-[#8A8478]">
                            {c.industry}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded border px-1 py-0.5 text-[9px] uppercase ${confidenceBadge(c.match_confidence)}`}
                      >
                        {c.match_confidence}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(selectingId) || isCurrent}
                      className="mt-2 rounded border border-[#2E7040]/50 bg-[#1B2F21] px-2 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setConfirmId(c.apollo_organization_id)}
                    >
                      {selectingId === c.apollo_organization_id
                        ? "Saving…"
                        : isCurrent
                          ? "Selected"
                          : "Use this company"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {!loading && !error && data?.candidates?.length === 0 ? (
            <p className="mt-3 text-xs text-[#D4C48A]">No Apollo organizations found for {label}.</p>
          ) : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded border border-white/15 px-3 py-1 text-xs text-[#DBEEE0] hover:bg-white/5"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <TargetListActionDialog
        open={confirmId != null}
        title="Use this Apollo company?"
        description={
          confirmCandidate ? (
            <>
              <p>
                Set <span className="text-[#DBEEE0]">{confirmCandidate.name}</span> as the Apollo
                record for {label}.
              </p>
              {companyId ? (
                <p className="text-[#AEA79A]">
                  Unrevealed Apollo contacts found for the previous match will be removed. Re-run
                  Find contacts after saving.
                </p>
              ) : (
                <p className="text-[#AEA79A]">Firmographics will be fetched for this organization.</p>
              )}
            </>
          ) : (
            <p>Confirm organization selection.</p>
          )
        }
        confirmLabel="Use this company"
        dismissStorageKey="apollo-org-picker-confirm"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          const id = confirmId;
          if (id) void applySelection(id);
        }}
      />
    </>
  );
}
