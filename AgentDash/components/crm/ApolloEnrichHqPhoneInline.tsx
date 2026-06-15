"use client";

import { useState } from "react";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_PULL_HQ_PHONE_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

type Props = {
  companyId: string;
  companyName?: string;
  hqPhone: string | null;
  website: string | null;
  disabled?: boolean;
  onHqPhone: (hqPhone: string | null) => void;
  onError?: (message: string) => void;
};

export function ApolloEnrichHqPhoneInline({
  companyId,
  companyName,
  hqPhone,
  website,
  disabled,
  onHqPhone,
  onError,
}: Props) {
  const [pulling, setPulling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const label = companyName || "this company";
  const hasWebsite = Boolean(String(website ?? "").trim());

  async function runPull(overwrite: boolean) {
    setPulling(true);
    try {
      const res = await fetch(`/api/apollo/companies/${companyId}/enrich-hq-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ overwrite }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Pull HQ phone failed");
      onHqPhone(data.hq_phone != null ? String(data.hq_phone) : null);
      if (!data.found && !data.hq_phone) {
        onError?.(`No HQ phone found in Apollo for ${label}`);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Pull HQ phone failed");
    } finally {
      setPulling(false);
    }
  }

  function requestPull() {
    if (disabled || pulling || !hasWebsite) return;
    if (isTargetListDialogDismissed(TARGET_LIST_PULL_HQ_PHONE_DISMISS_KEY)) {
      void runPull(Boolean(hqPhone));
      return;
    }
    setConfirmOpen(true);
  }

  if (!hasWebsite) return null;

  const btn =
    "block w-full rounded border px-1.5 py-0.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <TargetListActionDialog
        open={confirmOpen}
        title="Pull HQ phone from Apollo?"
        description={
          <>
            <p>
              Enrich <span className="font-medium text-[#E6E0D5]">{label}</span> via Apollo to fetch the
              corporate / switchboard number.
            </p>
            <p className="text-[#AEA79A]">Uses Apollo organization enrichment credits.</p>
          </>
        }
        confirmLabel={hqPhone ? "Refresh HQ phone" : "Pull HQ phone"}
        dismissStorageKey={TARGET_LIST_PULL_HQ_PHONE_DISMISS_KEY}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runPull(Boolean(hqPhone));
        }}
      />

      <button
        type="button"
        className={`${btn} border-[#3A4A5E]/60 bg-[#1A2028] text-[#B8C8DC] hover:bg-[#222A35]`}
        disabled={disabled || pulling}
        title="Apollo organization enrich — corporate HQ / switchboard number"
        onClick={() => requestPull()}
      >
        {pulling ? "Pulling HQ…" : hqPhone ? "Refresh HQ phone" : "Pull HQ phone"}
      </button>
    </div>
  );
}
