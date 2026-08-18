"use client";

import { useState } from "react";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { canEnrichContactViaApollo } from "@/lib/apollo/contact-enrichment";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";
import { safeHttpUrl } from "@/lib/security/url";

type Props = {
  contactId?: string;
  linkedinUrl: string | null | undefined;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  apolloPersonId?: string | null;
  onRevealed?: (contact: Record<string, unknown>) => void;
  compact?: boolean;
  disabled?: boolean;
};

export function ContactLinkedinCell({
  contactId,
  linkedinUrl,
  email,
  firstName,
  lastName,
  apolloPersonId,
  onRevealed,
  compact,
  disabled,
}: Props) {
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const safe = linkedinUrl ? safeHttpUrl(linkedinUrl) : null;
  const canEnrich =
    Boolean(contactId) &&
    !disabled &&
    canEnrichContactViaApollo({
      apollo_person_id: apolloPersonId,
      email,
      linkedin_url: linkedinUrl,
      first_name: firstName,
      last_name: lastName,
    });

  async function runReveal() {
    if (!contactId) return;
    setRevealing(true);
    setError(null);
    try {
      const res = await fetch("/api/apollo/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "LinkedIn reveal failed");
      onRevealed?.(data.contact ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "LinkedIn reveal failed");
    } finally {
      setRevealing(false);
    }
  }

  function requestReveal() {
    if (revealing || !contactId) return;
    if (isTargetListDialogDismissed(TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY)) {
      void runReveal();
      return;
    }
    setConfirmOpen(true);
  }

  if (safe) {
    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-[#CEE4D4] hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        LinkedIn
      </a>
    );
  }

  if (!canEnrich) {
    return <span className="text-[#8E877A]">—</span>;
  }

  const btn =
    "rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50";

  return (
    <div className={compact ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-1.5"}>
      <TargetListActionDialog
        open={confirmOpen}
        title="Reveal LinkedIn via Apollo?"
        description={
          <>
            <p>Fetch this contact&apos;s LinkedIn profile from Apollo using their email and company.</p>
            <p className="text-[#AEA79A]">This action uses Apollo credits.</p>
          </>
        }
        confirmLabel="Reveal LinkedIn"
        dismissStorageKey={TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runReveal();
        }}
      />
      <button
        type="button"
        disabled={revealing}
        onClick={() => requestReveal()}
        className={`${btn} border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]`}
      >
        {revealing ? "…" : "Reveal LinkedIn"}
      </button>
      {error ? <span className="block text-[10px] text-[#F1A2A2]">{error}</span> : null}
    </div>
  );
}
