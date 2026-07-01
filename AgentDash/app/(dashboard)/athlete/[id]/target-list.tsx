"use client";

import { TargetListSpreadsheet } from "@/components/crm/TargetListSpreadsheet";

export function AthleteTargetList({
  athleteId,
  athleteName,
  className,
}: {
  athleteId: string;
  athleteName?: string;
  className?: string;
}) {
  return (
    <TargetListSpreadsheet
      mode="athlete"
      athleteId={athleteId}
      athleteName={athleteName}
      className={className}
    />
  );
}
