import { AudienceCountList } from "@/components/insights/AudienceCountList";
import type { AudienceCountRow } from "@/lib/insights/roster-audience-insights";

type Props = {
  interests: AudienceCountRow[];
};

export function InterestReach({ interests }: Props) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="text-lg font-medium text-[#F4F1EB]">Interest reach</h2>
      <p className="mt-1 text-xs text-[#B9B2A6]">
        Estimated IG audience members aligned to each interest category across the roster.
      </p>
      <div className="mt-4">
        <AudienceCountList
          rows={interests}
          limit={15}
          emptyText="No interest data available."
        />
      </div>
      {interests.length > 0 && (
        <p className="mt-3 text-xs text-[#8E877A]">
          {interests.length} interest categories with audience data
        </p>
      )}
    </section>
  );
}
