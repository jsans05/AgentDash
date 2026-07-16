"use client";

import { CrmBrandIdeaQuickAdd } from "@/components/crm/CrmBrandIdeaQuickAdd";

export function PipelineAddBrandModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pipeline-add-brand-title"
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#151A17] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="pipeline-add-brand-title" className="mb-4 text-base font-semibold text-[#F4F1EB]">
          Add brand idea
        </h2>
        <CrmBrandIdeaQuickAdd layout="modal" onClose={onClose} onSuccess={onSuccess} />
      </div>
    </div>
  );
}
