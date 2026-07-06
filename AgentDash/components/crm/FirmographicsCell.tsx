import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import {
  formatFundingDisplay,
  formatGrowthPercent,
  formatRevenueDisplay,
  hasCompanyFirmographics,
} from "@/lib/crm/company-firmographics";

const MONEY_CLASS = "text-[#4F9E63]";
const GROWTH_UP_CLASS = "text-[#4F9E63]";
const GROWTH_DOWN_CLASS = "text-[#E57373]";
const LABEL_CLASS = "text-[#8E877A]";

function ensureDollarPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("$") ? trimmed : `$${trimmed}`;
}

function growthColorClass(value: number | null): string {
  return (value ?? 0) >= 0 ? GROWTH_UP_CLASS : GROWTH_DOWN_CLASS;
}

function GrowthInline({ label, value }: { label: string; value: number | null }) {
  const text = formatGrowthPercent(value);
  if (!text) return null;
  return (
    <span className={growthColorClass(value)}>
      <span className={LABEL_CLASS}>{label}</span>
      {text}
    </span>
  );
}

function FirmographicsGrowthRow({ firmographics }: { firmographics: CompanyFirmographics }) {
  const items = [
    { label: "6mo", value: firmographics.headcount_six_month_growth },
    { label: "12", value: firmographics.headcount_twelve_month_growth },
    { label: "24", value: firmographics.headcount_twenty_four_month_growth },
  ].filter((item) => formatGrowthPercent(item.value));

  if (items.length === 0) return null;

  return (
    <p className="whitespace-nowrap text-[10px] leading-none tabular-nums">
      {items.map((item, index) => (
        <span key={item.label}>
          {index > 0 ? <span className="text-[#8E877A]">,</span> : null}
          <GrowthInline label={item.label} value={item.value} />
        </span>
      ))}
    </p>
  );
}

export function FirmographicsCell({ firmographics }: { firmographics: CompanyFirmographics }) {
  if (!hasCompanyFirmographics(firmographics)) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }

  const revenue = formatRevenueDisplay(firmographics);
  const funding = formatFundingDisplay(firmographics);

  return (
    <div className="min-w-0 space-y-0.5 text-xs text-[#ECE7DF]">
      {revenue && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Revenue:</span>{" "}
          <span className={MONEY_CLASS}>{ensureDollarPrefix(revenue)}</span>
        </p>
      )}
      {(funding || firmographics.latest_funding_stage) && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Funding:</span>{" "}
          {funding ? <span className={MONEY_CLASS}>{ensureDollarPrefix(funding)}</span> : null}
          {funding && firmographics.latest_funding_stage ? (
            <span className="text-[#ECE7DF]"> · {firmographics.latest_funding_stage}</span>
          ) : firmographics.latest_funding_stage ? (
            <span className={MONEY_CLASS}>{firmographics.latest_funding_stage}</span>
          ) : null}
        </p>
      )}
      {firmographics.estimated_num_employees != null && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Employees:</span>{" "}
          {firmographics.estimated_num_employees.toLocaleString()}
        </p>
      )}
      <FirmographicsGrowthRow firmographics={firmographics} />
    </div>
  );
}
