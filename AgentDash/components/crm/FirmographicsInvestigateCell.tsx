"use client";

import { useState } from "react";
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
  const [note, setNote] = useState<string | null>(null);

  const label = companyName || "this company";

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/apollo/companies/${companyId}/enrich-firmographics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        firmographics?: Record<string, unknown> | null;
        patched?: string[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.error || `Investigate failed (${res.status})`);
      }
      onInvestigated(mapCompanyFirmographics(data.firmographics ?? null));
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
              Fetches revenue, funding, employee count, and headcount growth from Apollo for{" "}
              {label}.
            </p>
            <p className="text-[#AEA79A]">Uses the company website to match the Apollo org.</p>
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

      <FirmographicsCell firmographics={firmographics} />

      <button
        type="button"
        className="block w-full rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || busy}
        title="Fetch firmographics from Apollo"
        onClick={request}
      >
        {busy ? "Investigating…" : "Investigate"}
      </button>

      <CompanyRecentNewsButton
        companyId={companyId}
        companyName={companyName}
        disabled={disabled}
      />

      {note ? (
        <span className="block text-[10px] leading-snug text-[#F1A2A2]">{note}</span>
      ) : null}
    </div>
  );
}
