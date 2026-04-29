"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CrmPipelineKanban } from "@/components/crm/CrmPipelineKanban";

function CrmPipelineKanbanWithOpenQuery() {
  const sp = useSearchParams();
  const open = sp.get("open");
  return <CrmPipelineKanban initialOpenPipelineId={open} />;
}

export default function CrmPipelinePage() {
  return (
    <div className="min-h-0 flex flex-col rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
        <h1 className="text-lg font-semibold text-[#F4F1EB]">Pipeline</h1>
        <p className="text-sm text-[#B9B2A6]">Drag cards by the handle (⠿) to change stage, or use the card menu.</p>
      </div>
      <Suspense fallback={<div className="p-8 text-sm text-[#B9B2A6]">Loading pipeline…</div>}>
        <CrmPipelineKanbanWithOpenQuery />
      </Suspense>
    </div>
  );
}
