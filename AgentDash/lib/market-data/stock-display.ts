import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { googleFinanceUrl, isUsQuoteSymbol, resolveGoogleFinanceExchange } from "@/lib/market-data/stock-match";
export type StockTimeframe = "W" | "M" | "6M" | "YTD" | "1Y" | "5Y";
export const STOCK_TIMEFRAMES: StockTimeframe[] = ["W", "M", "6M", "YTD", "1Y", "5Y"];
export type StockChartPayload = {
  series: number[];
  returns: Partial<Record<StockTimeframe, number | null>>;
};
export function displayStockSymbol(f: CompanyFirmographics): string | null {
  return f.stock_symbol_override?.trim() || f.stock_symbol?.trim() || f.ticker?.trim() || null;
}
export function resolveGoogleFinanceQuote(f: CompanyFirmographics): {
  symbol: string;
  exchange: string | null;
} | null {
  const stockSymbol = (f.stock_symbol_override ?? f.stock_symbol)?.trim().toUpperCase() || null;
  const ticker = f.ticker?.trim().toUpperCase() || null;
  const usSymbol = stockSymbol && isUsQuoteSymbol(stockSymbol) ? stockSymbol : null;
  if (usSymbol) {
    return {
      symbol: usSymbol,
      exchange: resolveGoogleFinanceExchange(usSymbol, f.exchange)
    };
  }
  const symbol = stockSymbol || ticker;
  if (!symbol) return null;
  return {
    symbol,
    exchange: f.exchange
  };
}
export function stockGoogleFinanceUrl(f: CompanyFirmographics): string | null {
  const quote = resolveGoogleFinanceQuote(f);
  if (!quote) return null;
  return googleFinanceUrl(quote.symbol, quote.exchange);
}
export function formatExchangeShort(exchange: string | null | undefined): string | null {
  if (!exchange?.trim()) return null;
  const value = exchange.toUpperCase();
  if (value.includes("NASDAQ")) return "NASDAQ";
  if (value.includes("NYSE")) return "NYSE";
  if (value.includes("OTC") || value.includes("OOTC")) return "OTC";
  if (value.includes("EURONEXT")) return "Euronext";
  if (value.includes("TOKYO")) return "TSE";
  if (value.includes("LONDON") || value.includes("LSE")) return "LSE";
  return exchange.split(",")[0]?.trim() ?? exchange;
}
export function formatMarketCap(value: number | null | undefined): string | null {
  if (value == null || Number.isNaN(value)) return null;
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toLocaleString()}`;
}
export function formatStockPrice(price: number | null | undefined, currency: string | null | undefined): string | null {
  if (price == null || Number.isNaN(price)) return null;
  const code = currency?.trim().toUpperCase();
  if (!code || code === "USD") return `$${price.toFixed(2)}`;
  return `${price.toFixed(2)} ${code}`;
}
export function stockRangeIsConsistent(price: number | null | undefined, low: number | null | undefined, high: number | null | undefined): boolean {
  if (price == null || low == null || high == null) return false;
  if (low <= 0 || high <= 0 || price <= 0 || high < low) return false;
  return low <= price && price <= high && high / low < 20;
}
export function estimateOneMonthReturn(change3mPct: number | null | undefined): number | null {
  if (change3mPct == null || Number.isNaN(change3mPct)) return null;
  return (Math.pow(1 + change3mPct / 100, 1 / 3) - 1) * 100;
}
export function buildSparklineForReturn(currentPrice: number, periodReturn: number | null | undefined, points = 16): number[] {
  if (periodReturn == null || Number.isNaN(periodReturn)) {
    return [currentPrice, currentPrice];
  }
  const start = currentPrice / (1 + periodReturn / 100);
  if (!Number.isFinite(start) || start <= 0) return [currentPrice, currentPrice];
  return Array.from({
    length: points
  }, (_, index) => {
    const t = index / (points - 1);
    return start + (currentPrice - start) * t;
  });
}
export function buildStockChartPayload(opts: {
  sharePrice: number;
  change5d: number | null;
  change3m: number | null;
  change6m: number | null;
  changeYtd: number | null;
  change12m: number | null;
}): StockChartPayload {
  const returns: StockChartPayload["returns"] = {
    W: opts.change5d,
    M: estimateOneMonthReturn(opts.change3m),
    "6M": opts.change6m,
    YTD: opts.changeYtd,
    "1Y": opts.change12m,
    "5Y": null
  };
  return {
    series: buildSparklineFromReturns(opts.sharePrice, {
      change5d: opts.change5d,
      change3m: opts.change3m,
      change6m: opts.change6m,
      change12m: opts.change12m
    }) ?? [opts.sharePrice, opts.sharePrice],
    returns
  };
}
export function buildSparklineFromReturns(currentPrice: number, returns: {
  change5d?: number | null;
  change3m?: number | null;
  change6m?: number | null;
  change12m?: number | null;
}): number[] {
  const points: number[] = [];
  const pushFromReturn = (pct: number | null | undefined) => {
    if (pct == null || Number.isNaN(pct)) return;
    points.push(currentPrice / (1 + pct / 100));
  };
  pushFromReturn(returns.change12m);
  pushFromReturn(returns.change6m);
  pushFromReturn(returns.change3m);
  pushFromReturn(returns.change5d);
  points.push(currentPrice);
  const cleaned = points.filter(value => Number.isFinite(value) && value > 0);
  return cleaned.length >= 2 ? cleaned : [currentPrice, currentPrice];
}
export function parseStockSparkline(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const values = raw.map(item => typeof item === "number" ? item : Number(item)).filter(value => Number.isFinite(value) && value > 0);
    return values.length >= 2 ? values : null;
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as StockChartPayload).series)) {
    return parseStockSparkline((raw as StockChartPayload).series);
  }
  return null;
}
export function parseStockChartData(raw: unknown): StockChartPayload | null {
  if (Array.isArray(raw)) {
    const series = parseStockSparkline(raw);
    return series ? {
      series,
      returns: {}
    } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Partial<StockChartPayload>;
  const series = parseStockSparkline(payload.series);
  if (!series) return null;
  return {
    series,
    returns: payload.returns ?? {}
  };
}
export function stockReturnForTimeframe(chart: StockChartPayload | null, firmographics: CompanyFirmographics, timeframe: StockTimeframe): number | null {
  const fromChart = chart?.returns?.[timeframe];
  if (fromChart != null && Number.isFinite(fromChart)) return fromChart;
  switch (timeframe) {
    case "W":
      return firmographics.stock_change_5d_pct;
    case "M":
      return estimateOneMonthReturn(firmographics.stock_change_3m_pct);
    case "6M":
      return null;
    case "YTD":
      return null;
    case "1Y":
      return firmographics.stock_change_12m_pct;
    case "5Y":
      return null;
    default:
      return null;
  }
}
export function sparklineForTimeframe(chart: StockChartPayload | null, firmographics: CompanyFirmographics, timeframe: StockTimeframe): number[] {
  const price = firmographics.share_price;
  if (price == null || price <= 0) return chart?.series ?? [];
  const periodReturn = stockReturnForTimeframe(chart, firmographics, timeframe);
  if (periodReturn != null) {
    return buildSparklineForReturn(price, periodReturn);
  }
  return chart?.series ?? [price, price];
}