"use client";

import { Badge } from "@/components/ui/badge";
import { getCardSignals, type PipelineCadenceCard } from "@/lib/crm/pipeline-cadence-ui";

export function PipelineSignalBadges({ card }: { card: PipelineCadenceCard }) {
  const signals = getCardSignals(card).filter((s) => s.priority > 0);
  if (signals.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {signals.slice(0, 2).map((s) => (
        <Badge
          key={s.id}
          variant="secondary"
          className="border-white/10 bg-[#202723] px-1 py-0 text-[9px] text-[#CFC8BC]"
        >
          {s.label}
        </Badge>
      ))}
    </div>
  );
}
