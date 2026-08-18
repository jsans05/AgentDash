"use client";

import { useState } from "react";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { canEnrichContactViaApollo } from "@/lib/apollo/contact-enrichment";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_REVEAL_PHONE_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

type Props = {
  contactId: string;
  phone: string | null;
  apolloPersonId: string | null;
  apolloPhoneRevealStatus: "pending" | "revealed" | null;
  email?: string | null;
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  onRevealed?: (contact: Record<string, unknown>) => void;
  /** When set, empty non-Apollo phones can be typed and saved. */
  onManualSave?: (phone: string | null) => Promise<void> | void;
  compact?: boolean;
  disabled?: boolean;
};

export function ContactPhoneCell({
  contactId,
  phone,
  apolloPersonId,
  apolloPhoneRevealStatus,
  email,
  linkedinUrl,
  firstName,
  lastName,
  onRevealed,
  onManualSave,
  compact,
  disabled,
}: Props) {
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draft, setDraft] = useState(phone ?? "");
  const [saving, setSaving] = useState(false);

  const canEnrich = canEnrichContactViaApollo({
    apollo_person_id: apolloPersonId,
    email,
    linkedin_url: linkedinUrl,
    first_name: firstName,
    last_name: lastName,
  });
  const canReveal = !disabled && canEnrich && !phone && apolloPhoneRevealStatus !== "pending";
  const isPending = apolloPhoneRevealStatus === "pending" && !phone;

  async function runReveal() {
    setRevealing(true);
    setError(null);
    try {
      const res = await fetch("/api/apollo/people/reveal-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await readJsonResponse<{
        contact?: Record<string, unknown>;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Phone reveal failed");
      onRevealed?.(
        data.contact ?? {
          contact_id: contactId,
          apollo_phone_reveal_status: "pending",
        }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Phone reveal failed");
    } finally {
      setRevealing(false);
    }
  }

  function requestReveal() {
    if (revealing) return;
    if (isTargetListDialogDismissed(TARGET_LIST_REVEAL_PHONE_DISMISS_KEY)) {
      void runReveal();
      return;
    }
    setConfirmOpen(true);
  }

  async function saveManual() {
    if (!onManualSave) return;
    const next = draft.trim() || null;
    if (next === (phone?.trim() || null)) return;
    setSaving(true);
    setError(null);
    try {
      await onManualSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save phone");
      setDraft(phone ?? "");
    } finally {
      setSaving(false);
    }
  }

  if (phone) {
    return (
      <a href={`tel:${phone.replace(/\s/g, "")}`} className="break-all text-[#CEE4D4] hover:underline">
        {phone}
      </a>
    );
  }

  const btn =
    "rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50";

  return (
    <div className={compact ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-1.5"}>
      <TargetListActionDialog
        open={confirmOpen}
        title="Reveal phone via Apollo?"
        description={
          <>
            <p>
              Request this contact&apos;s phone numbers from Apollo. Work numbers may appear immediately;
              mobile numbers are verified asynchronously (usually within a few minutes).
            </p>
            <p className="text-[#AEA79A]">This action uses Apollo mobile/credits.</p>
          </>
        }
        confirmLabel="Reveal phone"
        dismissStorageKey={TARGET_LIST_REVEAL_PHONE_DISMISS_KEY}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void runReveal();
        }}
      />

      {isPending ? (
        <span className="text-[10px] text-[#D4C48A]">Revealing… (check back shortly)</span>
      ) : canReveal ? (
        <button
          type="button"
          disabled={revealing}
          onClick={() => requestReveal()}
          className={`${btn} border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]`}
        >
          {revealing ? "…" : "Reveal phone"}
        </button>
      ) : onManualSave && !disabled ? (
        <input
          type="tel"
          value={draft}
          disabled={saving}
          placeholder="Add phone"
          className="w-full min-w-[7rem] rounded border border-white/15 bg-[#101513] px-1.5 py-0.5 text-[11px] text-[#ECE7DF] placeholder:text-[#5E574C]"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void saveManual()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="text-[#8E877A]">—</span>
      )}
      {error ? <span className="block text-[10px] text-[#F1A2A2]">{error}</span> : null}
    </div>
  );
}
