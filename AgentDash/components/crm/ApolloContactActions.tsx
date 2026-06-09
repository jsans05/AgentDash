"use client";

import { useState } from "react";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_DELETE_CONTACT_DISMISS_KEY,
  TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

export type ApolloRevealStatus = "pending" | "revealed" | null;

type ConfirmMode = "reveal" | "delete";

type Props = {
  contactId: string;
  apolloRevealStatus: ApolloRevealStatus;
  onRevealed?: (contact: Record<string, unknown>) => void;
  onDeleted?: () => void;
  compact?: boolean;
  /** Hide remove-from-CRM (e.g. after outreach draft exists on target list). */
  hideDelete?: boolean;
};

export function ApolloContactActions({
  contactId,
  apolloRevealStatus,
  onRevealed,
  onDeleted,
  compact,
  hideDelete,
}: Props) {
  const [revealing, setRevealing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode | null>(null);

  const isApollo = apolloRevealStatus === "pending" || apolloRevealStatus === "revealed";
  const canReveal = apolloRevealStatus === "pending";

  async function runReveal() {
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
      if (!res.ok) throw new Error(data?.error || "Reveal failed");
      onRevealed?.(data.contact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setRevealing(false);
    }
  }

  async function runDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function requestReveal() {
    if (revealing || deleting) return;
    if (isTargetListDialogDismissed(TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY)) {
      void runReveal();
      return;
    }
    setConfirmMode("reveal");
  }

  function requestDelete() {
    if (revealing || deleting) return;
    if (isTargetListDialogDismissed(TARGET_LIST_DELETE_CONTACT_DISMISS_KEY)) {
      void runDelete();
      return;
    }
    setConfirmMode("delete");
  }

  if (!contactId) {
    return <span className="text-[#8E877A]">—</span>;
  }

  const btn =
    "rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50";

  const deleteIsRevealed = apolloRevealStatus === "revealed";

  return (
    <div className={compact ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-1.5"}>
      <TargetListActionDialog
        open={confirmMode === "reveal"}
        title="Reveal contact via Apollo?"
        description={
          <>
            <p>
              Fetch this contact&apos;s work email and LinkedIn profile from Apollo. This action uses
              Apollo credits.
            </p>
            <p className="text-[#AEA79A]">
              Contact search does not use credits — only revealing email and LinkedIn does.
            </p>
          </>
        }
        confirmLabel="Reveal"
        dismissStorageKey={TARGET_LIST_REVEAL_CONTACT_DISMISS_KEY}
        onCancel={() => setConfirmMode(null)}
        onConfirm={() => {
          setConfirmMode(null);
          void runReveal();
        }}
      />

      <TargetListActionDialog
        open={confirmMode === "delete"}
        title={deleteIsRevealed ? "Delete contact from CRM?" : "Remove Apollo contact?"}
        variant="danger"
        description={
          deleteIsRevealed ? (
            <>
              <p>This contact will be removed from your CRM, including any saved email and LinkedIn data.</p>
              <p className="text-[#AEA79A]">This cannot be undone.</p>
            </>
          ) : (
            <>
              <p>
                Remove this Apollo contact candidate from the target list. No credits were used for this
                contact yet.
              </p>
              <p className="text-[#AEA79A]">You can find contacts again later with Find contacts.</p>
            </>
          )
        }
        confirmLabel="Delete"
        dismissStorageKey={TARGET_LIST_DELETE_CONTACT_DISMISS_KEY}
        onCancel={() => setConfirmMode(null)}
        onConfirm={() => {
          setConfirmMode(null);
          void runDelete();
        }}
      />

      {canReveal ? (
        <button
          type="button"
          disabled={revealing || deleting}
          onClick={() => requestReveal()}
          className={`${btn} border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]`}
        >
          {revealing ? "…" : "Reveal"}
        </button>
      ) : null}
      {!hideDelete && (isApollo || contactId) ? (
        <button
          type="button"
          disabled={revealing || deleting}
          onClick={() => requestDelete()}
          className={`${btn} border-[#8C3A3A]/50 bg-[#2A1818] text-[#F1A2A2] hover:bg-[#3A1E1E]`}
        >
          {deleting ? "…" : "Delete"}
        </button>
      ) : null}
      {error ? <span className="block text-[10px] text-[#F1A2A2]">{error}</span> : null}
    </div>
  );
}
