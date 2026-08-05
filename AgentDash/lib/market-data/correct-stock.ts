import type { CompanyFirmographics } from "@/lib/crm/company-firmographics";
import { fetchFinnhubMarketDataForSymbol, type FinnhubMarketData } from "@/lib/market-data/finnhub";
import { isVerifiedStockMatch } from "@/lib/market-data/stock-match";
const EXCHANGE_CODES = new Set(["NYSE", "NASDAQ", "OTCMKTS", "OTC", "EPA", "EURONEXT", "TYO", "LON", "LSE", "WSE"]);
export function normalizeManualStockSymbol(raw: string): string | null {
  let value = raw.trim().toUpperCase();
  if (!value) return null;
  if (value.includes(":")) {
    const parts = value.split(":").map(part => part.trim()).filter(Boolean);
    const symbolPart = parts.find(part => !EXCHANGE_CODES.has(part) && /^[A-Z0-9.]{1,12}$/.test(part)) ?? parts[0];
    value = symbolPart ?? value;
  }
  if (!/^[A-Z0-9.]{1,12}$/.test(value)) return null;
  return value;
}
export function marketDataToStockPatch(market: FinnhubMarketData, overrideSymbol: string): Partial<CompanyFirmographics> {
  return {
    stock_symbol_override: overrideSymbol,
    ticker: market.ticker,
    stock_symbol: market.stock_symbol ?? overrideSymbol,
    exchange: market.exchange,
    stock_currency: market.stock_currency,
    market_cap: market.market_cap,
    share_price: market.share_price,
    share_price_change_pct: market.share_price_change_pct,
    stock_change_5d_pct: market.stock_change_5d_pct,
    stock_change_3m_pct: market.stock_change_3m_pct,
    stock_change_12m_pct: market.stock_change_12m_pct,
    stock_52w_high: market.stock_52w_high,
    stock_52w_low: market.stock_52w_low,
    stock_beta: market.stock_beta,
    stock_sparkline: market.stock_sparkline,
    market_data_as_of: market.market_data_as_of
  };
}
export async function resolveManualStockCorrection(opts: {
  symbol: string;
  companyName?: string | null;
  domain?: string | null;
}): Promise<{
  market: FinnhubMarketData;
  patch: Partial<CompanyFirmographics>;
  warning: string | null;
}> {
  const normalized = normalizeManualStockSymbol(opts.symbol);
  if (!normalized) {
    throw new Error("Enter a valid ticker symbol (e.g. TM, MGDDY, ML.PA).");
  }
  const market = await fetchFinnhubMarketDataForSymbol(normalized, opts.companyName ?? undefined);
  if (!market.stock_symbol && !market.share_price) {
    throw new Error(`Could not load market data for ${normalized}. Check the symbol and try again.`);
  }
  const profileName = opts.companyName?.trim();
  let warning: string | null = null;
  if (profileName) {
    const verified = isVerifiedStockMatch({
      companyName: profileName,
      domain: opts.domain,
      profileName: market.quote_company_name,
      profileWeburl: market.quote_company_weburl,
      searchDescription: normalized
    });
    if (!verified) {
      warning = `${normalized} may not match ${profileName}. Saved anyway.`;
    }
  }
  return {
    market,
    patch: marketDataToStockPatch(market, normalized),
    warning
  };
}