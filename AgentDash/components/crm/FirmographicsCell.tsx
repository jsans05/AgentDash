"use client";

import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import {
  formatDepartmentalSummary,
  formatFundingDisplay,
  formatGrowthPercent,
  formatMetaAdsDisplay,
  formatRevenueDisplay,
  formatStockDisplay,
  hasCompanyFirmographics,
  isFirmographicsStale,
} from "@/lib/crm/company-firmographics";
import { hasStockSnapshot, StockSnapshot } from "@/components/crm/StockSnapshot";
import type { StockCorrectionContext } from "@/components/crm/StockTickerCorrectionDialog";

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

type FirmographicsCellProps = {
  firmographics: CompanyFirmographics;
  compact?: boolean;
  brandName?: string | null;
  stockCorrection?: StockCorrectionContext;
};

export function FirmographicsCell({
  firmographics,
  compact = false,
  brandName,
  stockCorrection,
}: FirmographicsCellProps) {
  if (!hasCompanyFirmographics(firmographics)) {
    return <span className="text-xs text-[#8E877A]">—</span>;
  }

  const revenue = formatRevenueDisplay(firmographics);
  const funding = formatFundingDisplay(firmographics);
  const stock = formatStockDisplay(firmographics);
  const metaAds = formatMetaAdsDisplay(firmographics, brandName);
  const dept = formatDepartmentalSummary(firmographics.departmental_head_count);
  const stale = isFirmographicsStale(firmographics.firmographics_enriched_at);

  return (
    <div className="min-w-0 space-y-0.5 text-xs text-[#ECE7DF]">
      {firmographics.domain && !compact && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Domain:</span> {firmographics.domain}
        </p>
      )}
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
      {firmographics.latest_funding_round_date && !compact && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Latest round:</span>{" "}
          {new Date(firmographics.latest_funding_round_date).toLocaleDateString()}
        </p>
      )}
      {firmographics.estimated_num_employees != null && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Employees:</span>{" "}
          {firmographics.estimated_num_employees.toLocaleString()}
        </p>
      )}
      <FirmographicsGrowthRow firmographics={firmographics} />
      {dept && !compact && (
        <p className="leading-snug text-[10px] text-[#B9B2A6]">
          <span className={LABEL_CLASS}>Depts:</span> {dept}
        </p>
      )}
      {hasStockSnapshot(firmographics) || stockCorrection ? (
        <div className="leading-snug">
          {!compact ? <span className={LABEL_CLASS}>Stock:</span> : null}
          <StockSnapshot
            firmographics={firmographics}
            compact={compact}
            brandName={brandName}
            stockCorrection={stockCorrection}
          />
        </div>
      ) : stock ? (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Stock:</span> {stock}
        </p>
      ) : null}
      {firmographics.open_jobs_count != null && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Open jobs:</span> {firmographics.open_jobs_count}
          {firmographics.open_jobs_source ? ` (${firmographics.open_jobs_source})` : ""}
        </p>
      )}
      {firmographics.instagram_handle && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Instagram:</span>{" "}
          <a
            href={`https://www.instagram.com/${firmographics.instagram_handle.replace(/^@/, "")}/`}
            target="_blank"
            rel="noreferrer"
            className="text-[#CEE4D4] underline"
            onClick={(e) => e.stopPropagation()}
          >
            @{firmographics.instagram_handle.replace(/^@/, "")}
          </a>
        </p>
      )}
      {(metaAds || firmographics.meta_ads_library_url) && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Meta ads:</span>{" "}
          {firmographics.meta_ads_library_url ? (
            <a
              href={firmographics.meta_ads_library_url}
              target="_blank"
              rel="noreferrer"
              className="text-[#CEE4D4] underline"
              onClick={(e) => e.stopPropagation()}
            >
              {metaAds ?? "View active ads"}
            </a>
          ) : (
            metaAds
          )}
        </p>
      )}
      {firmographics.spend_readiness_label && (
        <p className="leading-snug">
          <span className={LABEL_CLASS}>Spend readiness:</span>{" "}
          <span className="text-[#DBEEE0]">{firmographics.spend_readiness_label}</span>
        </p>
      )}
      {firmographics.match_notes && !compact && (
        <p className="text-[10px] text-[#AEA79A]">{firmographics.match_notes}</p>
      )}
      {firmographics.firmographics_enriched_at && (
        <p className={`text-[10px] ${stale ? "text-[#D4C48A]" : "text-[#8E877A]"}`}>
          Enriched {new Date(firmographics.firmographics_enriched_at).toLocaleDateString()}
          {stale ? " · consider re-investigating" : ""}
        </p>
      )}
    </div>
  );
}

export function isHiringOrLayoffNews(categories: string[]): boolean {
  const joined = categories.join(" ").toLowerCase();
  return /hiring|layoff|workforce|headcount|job/i.test(joined);
}

export function isFundingNews(categories: string[]): boolean {
  const joined = categories.join(" ").toLowerCase();
  return /funding|investment|raise|series|venture/i.test(joined);
}
