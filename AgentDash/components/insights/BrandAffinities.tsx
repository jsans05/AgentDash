import { AudienceCountList } from "@/components/insights/AudienceCountList";
import type { AudienceCountRow } from "@/lib/insights/roster-audience-insights";

type Props = {
  brands: AudienceCountRow[];
};

export function BrandAffinities({ brands }: Props) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="text-lg font-medium text-[#F4F1EB]">Brand affinities</h2>
      <p className="mt-1 text-xs text-[#B9B2A6]">
        Top brand affinities in the roster IG audience. Names reflect imported affinity labels, not CRM companies.
      </p>
      <div className="mt-4">
        <AudienceCountList
          rows={brands}
          limit={20}
          emptyText="No brand affinity data available."
        />
      </div>
    </section>
  );
}
