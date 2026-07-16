import type { AudienceCountRow } from "@/lib/insights/roster-audience-insights";
import { AudienceCountList } from "@/components/insights/AudienceCountList";

type Props = {
  gender: AudienceCountRow[];
  age: AudienceCountRow[];
  countries: AudienceCountRow[];
};

export function DemographicReach({ gender, age, countries }: Props) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151A17] p-6 shadow">
      <h2 className="text-lg font-medium text-[#F4F1EB]">Demographic reach</h2>
      <p className="mt-1 text-xs text-[#B9B2A6]">
        Roster-wide Instagram audience composition by estimated audience count.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div>
          <h3 className="text-sm font-medium text-[#ECE7DF]">Gender</h3>
          <AudienceCountList rows={gender} limit={6} emptyText="No gender data." />
        </div>
        <div>
          <h3 className="text-sm font-medium text-[#ECE7DF]">Age</h3>
          <AudienceCountList rows={age} limit={8} emptyText="No age data." />
        </div>
        <div>
          <h3 className="text-sm font-medium text-[#ECE7DF]">Top countries</h3>
          <AudienceCountList rows={countries} limit={8} emptyText="No country data." />
        </div>
      </div>
    </section>
  );
}
