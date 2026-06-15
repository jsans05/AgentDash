"use client";

import { AthleteTargetList } from "./target-list";

type Props = {
  athleteId: string;
  athleteName: string;
};

export function OutreachTab({ athleteId, athleteName }: Props) {
  return (
    <AthleteTargetList athleteId={athleteId} athleteName={athleteName} className="min-h-0 flex-1" />
  );
}
