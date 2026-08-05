"use client";

import { useState } from "react";
import { ApolloOrgPickerDialog } from "@/components/crm/ApolloOrgPickerDialog";
import { CompanyRecentNewsButton } from "@/components/crm/CompanyRecentNewsPanel";
import { FirmographicsCell } from "@/components/crm/FirmographicsCell";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import {
  mapCompanyFirmographics,
  type CompanyFirmographics,
} from "@/lib/crm/company-firmographics";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_INVESTIGATE_FIRMOGRAPHICS_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

type FirmographicsInvestigateCellProps = {
  companyId: string;
  companyName?: string;
  firmographics: CompanyFirmographics;
  disabled?: boolean;
  onInvestigated: (firmographics: CompanyFirmographics) => void;
  onError?: (message: string) => void;
};

export function FirmographicsInvestigateCell({
  companyId,
  companyName,
  firmographics,
  disabled,
  onInvestigated,
  onError,
}: FirmographicsInvestigateCellProps) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [matchNote, setMatchNote] = useState<string | null>(firmographics.match_notes);

  const label = companyName || "this company";

  async function run(apollo_organization_id?: string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/apollo/companies/${companyId}/enrich-firmographics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force: true, apollo_organization_id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        needsConfirmation?: boolean;
        match_notes?: string | null;
        firmographics?: Record<string, unknown> | null;
        patched?: string[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.error || `Investigate failed (${res.status})`);
      }

      if (data.needsConfirmation) {
        setMatchNote(data.match_notes ?? "Confirm the correct Apollo company.");
        setOrgPickerOpen(true);
        return;
      }

      onInvestigated(mapCompanyFirmographics(data.firmographics ?? null));
      setMatchNote(data.match_notes ?? null);
      if (!data.patched || data.patched.length === 0) {
        setNote("No new firmographics found");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Investigate failed";
      setNote(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }

  function request() {
    if (disabled || busy) return;
    if (isTargetListDialogDismissed(TARGET_LIST_INVESTIGATE_FIRMOGRAPHICS_DISMISS_KEY)) {
      void run();
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <TargetListActionDialog
        open={confirmOpen}
        title="Investigate firmographics via Apollo?"
        description={
          <>
            <p>
              Fetches revenue, funding, employee count, headcount growth, stock, hiring, and Meta
              ads signals for {label}.
            </p>
            <p className="text-[#AEA79A]">
              Uses trusted Apollo org matching — you may be asked to confirm the company.
            </p>
          </>
        }
        confirmLabel="Investigate"
        dismissStorageKey={TARGET_LIST_INVESTIGATE_FIRMOGRAPHICS_DISMISS_KEY}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void run();
        }}
      />

      <ApolloOrgPickerDialog
        open={orgPickerOpen}
        companyId={companyId}
        companyName={companyName}
        onClose={() => setOrgPickerOpen(false)}
        onSelected={({ apollo_organization_id }) => {
          setOrgPickerOpen(false);
          void run(apollo_organization_id);
        }}
      />

      <FirmographicsCell
        brandName={companyName}
        firmographics={{ ...firmographics, match_notes: matchNote ?? firmographics.match_notes }}
        stockCorrection={{
          companyId,
          companyName,
          domain: firmographics.domain,
          onCorrected: (updated) => onInvestigated(updated),
        }}
      />

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || busy}
          title="Fetch firmographics from Apollo"
          onClick={request}
        >
          {busy ? "Investigating…" : "Investigate"}
        </button>
        <button
          type="button"
          className="rounded border border-white/15 bg-[#1A211D] px-1.5 py-0.5 text-[10px] text-[#CEE4D4] hover:bg-[#243028] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || busy}
          onClick={() => setOrgPickerOpen(true)}
        >
          Wrong company?
        </button>
      </div>

      <CompanyRecentNewsButton companyId={companyId} companyName={companyName} disabled={disabled} />

      {note ? (
        <span className="block text-[10px] leading-snug text-[#F1A2A2]">{note}</span>
      ) : null}
    </div>
  );
}
