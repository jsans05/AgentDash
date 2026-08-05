"use client";

import { useState } from "react";
import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { formatGrowthPercent } from "@/lib/crm/company-firmographics";
import { displayStockSymbol, formatExchangeShort, formatMarketCap, formatStockPrice, parseStockChartData, sparklineForTimeframe, stockGoogleFinanceUrl, stockReturnForTimeframe, STOCK_TIMEFRAMES, type StockTimeframe } from "@/lib/market-data/stock-display";
import { resolveStockParentLookup } from "@/lib/market-data/stock-parent-map";
import { StockSparkline } from "@/components/crm/StockSparkline";
import { StockTickerCorrectionDialog, type StockCorrectionContext } from "@/components/crm/StockTickerCorrectionDialog";
const UP_CLASS = "text-[#4F9E63]";
const DOWN_CLASS = "text-[#E57373]";
type StockSnapshotProps = {
  firmographics: CompanyFirmographics;
  compact?: boolean;
  brandName?: string | null;
  stockCorrection?: StockCorrectionContext;
};
export function StockSnapshot({
  firmographics,
  compact = false,
  brandName,
  stockCorrection
}: StockSnapshotProps) {
  const [timeframe, setTimeframe] = useState<StockTimeframe>("1Y");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const symbol = displayStockSymbol(firmographics);
  const chart = parseStockChartData(firmographics.stock_sparkline);
  if (!symbol && !stockCorrection) return null;
  const price = formatStockPrice(firmographics.share_price, firmographics.stock_currency);
  const dailyChange = formatGrowthPercent(firmographics.share_price_change_pct);
  const dailyPositive = (firmographics.share_price_change_pct ?? 0) >= 0;
  const exchange = formatExchangeShort(firmographics.exchange);
  const marketCap = formatMarketCap(firmographics.market_cap);
  const periodReturn = stockReturnForTimeframe(chart, firmographics, timeframe);
  const periodChange = formatGrowthPercent(periodReturn);
  const periodPositive = (periodReturn ?? 0) >= 0;
  const sparkline = sparklineForTimeframe(chart, firmographics, timeframe);
  const listingTicker = firmographics.ticker && firmographics.stock_symbol && firmographics.ticker !== firmographics.stock_symbol ? firmographics.ticker : null;
  const googleFinanceLink = stockGoogleFinanceUrl(firmographics);
  const parentLookup = brandName ? resolveStockParentLookup(brandName, firmographics.domain) : null;
  const showsParentListing = Boolean(parentLookup?.parentCompanyName);
  if (compact) {
    return <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-[#F4F1EB]">{symbol}</span>
          {price ? <span className="text-sm text-[#ECE7DF]">{price}</span> : null}
          {dailyChange ? <span className={dailyPositive ? UP_CLASS : DOWN_CLASS}>{dailyChange}</span> : null}
        </div>
      </div>;
  }
  if (!symbol && stockCorrection) {
    return <>
        <div className="mt-1 rounded-md border border-white/5 bg-[#121816] px-2.5 py-2">
          <p className="text-xs text-[#8E877A]">No stock ticker linked yet.</p>
          <button type="button" onClick={event => {
          event.stopPropagation();
          setCorrectionOpen(true);
        }} className="mt-2 text-[10px] text-[#B9B2A6] underline decoration-[#8E877A]/40 underline-offset-2 hover:text-[#ECE7DF]">
            Wrong stock?
          </button>
        </div>
        <StockTickerCorrectionDialog open={correctionOpen} firmographics={firmographics} context={stockCorrection} onClose={() => setCorrectionOpen(false)} />
      </>;
  }
  if (!symbol) return null;
  return <>
      <div className="mt-1 rounded-md border border-white/5 bg-[#121816] px-2.5 py-2">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {googleFinanceLink ? <a href={googleFinanceLink} target="_blank" rel="noreferrer" className="font-medium text-[#CEE4D4] underline decoration-[#CEE4D4]/40 underline-offset-2 hover:text-[#DBEEE0]" onClick={e => e.stopPropagation()}>
                {symbol}
              </a> : <span className="font-medium text-[#F4F1EB]">{symbol}</span>}
            {exchange ? <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-[#B9B2A6]">
                {exchange}
              </span> : null}
            {firmographics.stock_symbol_override ? <span className="rounded-full border border-[#4F9E63]/30 px-1.5 py-0.5 text-[10px] text-[#DBEEE0]">
                Manual
              </span> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {price ? <span className="text-sm font-medium text-[#ECE7DF]">{price}</span> : null}
            {dailyChange ? <span className={`text-xs ${dailyPositive ? UP_CLASS : DOWN_CLASS}`}>
                {dailyChange} today
              </span> : null}
          </div>
        </div>
        {periodChange ? <div className="text-right">
            <p className={`text-sm font-medium tabular-nums ${periodPositive ? UP_CLASS : DOWN_CLASS}`}>
              {periodChange}
            </p>
            <p className="text-[10px] text-[#8E877A]">{timeframe} change</p>
          </div> : null}
      </div>

      {listingTicker ? <p className="mt-1 text-[10px] text-[#8E877A]">Primary listing: {listingTicker}</p> : null}
      {showsParentListing ? <p className="mt-0.5 text-[10px] text-[#8E877A]">
          Public parent: {parentLookup?.parentCompanyName} ({symbol})
        </p> : null}

      {sparkline.length >= 2 ? <div className="mt-2">
          <StockSparkline values={sparkline} positive={periodPositive} className="w-full" />
        </div> : null}

      <div className="mt-2 flex flex-wrap gap-1">
        {STOCK_TIMEFRAMES.map(frame => {
          const active = frame === timeframe;
          return <button key={frame} type="button" onClick={event => {
            event.stopPropagation();
            setTimeframe(frame);
          }} className={`rounded-full border px-2 py-0.5 text-[10px] tabular-nums transition-colors ${active ? "border-[#4F9E63]/50 bg-[#1B2F21] text-[#DBEEE0]" : "border-white/10 bg-transparent text-[#B9B2A6] hover:border-white/20 hover:text-[#ECE7DF]"}`}>
              {frame}
            </button>;
        })}
      </div>

      {(marketCap || firmographics.stock_beta != null) && <p className="mt-2 text-[10px] text-[#B9B2A6]">
          {[marketCap ? `${marketCap} mkt cap` : null, firmographics.stock_beta != null ? `beta ${firmographics.stock_beta.toFixed(2)}` : null].filter(Boolean).join(" · ")}
        </p>}

      {stockCorrection ? <button type="button" onClick={event => {
        event.stopPropagation();
        setCorrectionOpen(true);
      }} className="mt-2 text-[10px] text-[#B9B2A6] underline decoration-[#8E877A]/40 underline-offset-2 hover:text-[#ECE7DF]">
          Wrong stock?
        </button> : null}
      </div>

      {stockCorrection ? <StockTickerCorrectionDialog open={correctionOpen} firmographics={firmographics} context={stockCorrection} onClose={() => setCorrectionOpen(false)} /> : null}
    </>;
}
export function hasStockSnapshot(firmographics: CompanyFirmographics): boolean {
  return Boolean(displayStockSymbol(firmographics));
}