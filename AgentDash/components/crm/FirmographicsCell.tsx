import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import {
  formatFundingDisplay,
  formatGrowthPercent,
  formatRevenueDisplay,
  hasCompanyFirmographics,
} from "@/lib/crm/company-firmographics";

function GrowthLine({ label, value }: { label: string; value: number | null }) {
  const text = formatGrowthPercent(value);
  if (!text) return null;
  const positive = (value ?? 0) >= 0;
  return (
    <span
      className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${
        positive
          ? "border-[#2E7040]/50 bg-[#1B2F21] text-[#DBEEE0]"
          : "border-[#8C3A3A]/50 bg-[#3A1E1E] text-[#F8D0D0]"
      }`}
    >
      {text} {label}
    </span>
  );
}

export function FirmographicsCell({ firmographics }: { firmographics: CompanyFirmographics }) {
  if (!hasCompanyFirmographics(firmographics)) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }

  const revenue = formatRevenueDisplay(firmographics);
  const funding = formatFundingDisplay(firmographics);

  return (
    <div className="min-w-[10rem] space-y-1 text-xs text-[#ECE7DF]">
      {revenue && (
        <p>
          <span className="text-[#8E877A]">Revenue:</span> {revenue}
        </p>
      )}
      {(funding || firmographics.latest_funding_stage) && (
        <p>
          <span className="text-[#8E877A]">Funding:</span>{" "}
          {[funding, firmographics.latest_funding_stage].filter(Boolean).join(" · ")}
        </p>
      )}
      {firmographics.estimated_num_employees != null && (
        <p>
          <span className="text-[#8E877A]">Employees:</span>{" "}
          {firmographics.estimated_num_employees.toLocaleString()}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <GrowthLine label="6mo" value={firmographics.headcount_six_month_growth} />
        <GrowthLine label="12mo" value={firmographics.headcount_twelve_month_growth} />
        <GrowthLine label="24mo" value={firmographics.headcount_twenty_four_month_growth} />
      </div>
    </div>
  );
}
