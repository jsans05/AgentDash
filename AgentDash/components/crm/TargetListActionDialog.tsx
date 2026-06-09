"use client";

import { useEffect, useId, useState } from "react";
import { setTargetListDialogDismissed } from "@/lib/crm/target-list-prefs";

type TargetListActionDialogProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  dismissStorageKey: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TargetListActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  dismissStorageKey,
  onConfirm,
  onCancel,
}: TargetListActionDialogProps) {
  const checkboxId = useId();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (!open) setDontShowAgain(false);
  }, [open]);

  if (!open) return null;

  function handleConfirm() {
    if (dontShowAgain) {
      setTargetListDialogDismissed(dismissStorageKey, true);
    }
    onConfirm();
  }

  const confirmClass =
    variant === "danger"
      ? "border-[#8C3A3A]/60 bg-[#3A1E1E] text-[#F8D0D0] hover:bg-[#4A2424]"
      : "border-[#2E7040]/60 bg-[#1B2F21] text-[#DBEEE0] hover:bg-[#23452E]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${checkboxId}-title`}
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#151917] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={`${checkboxId}-title`} className="text-base font-semibold text-[#F4F1EB]">
          {title}
        </h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-[#B9B2A6]">{description}</div>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-[#AEA79A]">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-white/20 bg-[#101311] text-[#2E7040] focus:ring-[#2E7040]/50"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          Don&apos;t show me again
        </label>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-[#D1CABF] hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
