"use client";

import Link from "next/link";
import { AthleteTargetList } from "./target-list";

type Props = {
  athleteId: string;
  athleteName: string;
};

export function OutreachTab({ athleteId, athleteName }: Props) {
  return (
    <div className="space-y-6">
      <AthleteTargetList athleteId={athleteId} athleteName={athleteName} />

      <div className="rounded-lg border border-white/10 bg-[#1A211D] p-4">
        <h2 className="mb-2 text-lg font-medium text-[#F4F1EB]">Outreach & Prospecting</h2>
        <p className="mb-4 text-sm text-[#D7D0C4]">
          All prospecting runs in <strong>Mystery Machine</strong>. There you can get sponsor recommendations for this athlete or any others, using their sport, accolades, audience data, current sponsors, and exclusivities.
        </p>
        <Link
          href={`/ai?athlete_id=${encodeURIComponent(athleteId)}&context=target_list&athlete_name=${encodeURIComponent(athleteName)}`}
          className="inline-flex items-center rounded-md bg-[#2E7040] px-4 py-2 text-sm font-medium text-white hover:bg-[#285F36]"
        >
          Open Mystery Machine to prospect for {athleteName}
        </Link>
      </div>
    </div>
  );
}
