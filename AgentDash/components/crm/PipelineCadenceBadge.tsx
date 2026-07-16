"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getCadenceBadge } from "@/lib/crm/pipeline-cadence-ui";
import type { PipelineCadenceCard } from "@/lib/crm/pipeline-cadence-ui";

export function PipelineCadenceBadge({
  card,
  className,
}: {
  card: PipelineCadenceCard;
  className?: string;
}) {
  const label = getCadenceBadge(card);
  if (!label) return null;

  const isCall = label === "Call due";
  const isCooling = label.startsWith("Cooling");

  return (
    <Badge
      variant="secondary"
      className={cn(
        "mt-1 border px-1.5 py-0 text-[10px] font-medium",
        isCall && "border-amber-400/50 bg-amber-950/40 text-amber-200",
        isCooling && "border-white/15 bg-[#202723] text-[#B9B2A6]",
        !isCall && !isCooling && "border-[#2E7040]/40 bg-[#1A2A20] text-[#A7E0B6]",
        className
      )}
    >
      {label}
    </Badge>
  );
}
