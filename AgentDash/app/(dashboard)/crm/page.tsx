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
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-2">
        <h1 className="text-base font-semibold text-[#F4F1EB]" title="Drag cards by the handle (⠿) to change stage">
          Pipeline
        </h1>
      </div>
      <Suspense fallback={<div className="p-8 text-sm text-[#B9B2A6]">Loading pipeline…</div>}>
        <CrmPipelineKanbanWithOpenQuery />
      </Suspense>
    </div>
  );
}
