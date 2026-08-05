import { buildStockChartPayload, stockRangeIsConsistent, type StockChartPayload } from "@/lib/market-data/stock-display";
import { domainMatchesProfile, inferUsListingExchange, isVerifiedStockMatch, isUsQuoteSymbol, meaningfulBrandTokens, scoreCompanyNameAgainstProfile } from "@/lib/market-data/stock-match";
import { resolveStockParentLookup } from "@/lib/market-data/stock-parent-map";
export type FinnhubMarketData = {
  ticker: string | null;
  stock_symbol: string | null;
  exchange: string | null;
  stock_currency: string | null;
  market_cap: number | null;
  share_price: number | null;
  share_price_change_pct: number | null;
  stock_change_5d_pct: number | null;
  stock_change_3m_pct: number | null;
  stock_change_12m_pct: number | null;
  stock_52w_high: number | null;
  stock_52w_low: number | null;
  stock_beta: number | null;
  stock_sparkline: StockChartPayload | null;
  market_data_as_of: string | null;
  quote_company_name: string | null;
  quote_company_weburl: string | null;
};
type FinnhubGetResult<T> = {
  data: T | null;
  status: number;
};
type ProfileResponse = {
  ticker?: string;
  exchange?: string;
  marketCapitalization?: number;
  name?: string;
  weburl?: string;
  currency?: string;
};
type QuoteResponse = {
  c?: number;
  pc?: number;
  dp?: number;
};
type MetricResponse = {
  metric?: Record<string, number>;
};
type SearchResponse = {
  count?: number;
  result?: Array<{
    description?: string;
    displaySymbol?: string;
    symbol?: string;
    type?: string;
  }>;
};
type UsSymbolRow = {
  symbol?: string;
  description?: string;
  type?: string;
};
type SymbolCandidate = {
  symbol: string;
  searchDescription?: string;
  source: "search" | "us-list";
};
const US_SYMBOLS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let usSymbolsCache: {
  fetchedAt: number;
  rows: UsSymbolRow[];
} | null = null;
function finnhubToken(): string | null {
  const key = process.env.FINNHUB_API_KEY?.trim();
  return key || null;
}
async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<FinnhubGetResult<T>> {
  const token = finnhubToken();
  if (!token) return {
    data: null,
    status: 0
  };
  const url = new URL(`https://finnhub.io/api/v1/${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("token", token);
  try {
    const res = await fetch(url.toString(), {
      next: {
        revalidate: 0
      }
    });
    if (!res.ok) {
      return {
        data: null,
        status: res.status
      };
    }
    return {
      data: (await res.json()) as T,
      status: res.status
    };
  } catch {
    return {
      data: null,
      status: 0
    };
  }
}
export function scoreFinnhubSearchResult(row: NonNullable<SearchResponse["result"]>[number], companyName: string): number {
  return scoreCompanyNameAgainstProfile(undefined, companyName, row.description);
}
export function scoreUsSymbolRow(row: UsSymbolRow, companyName: string): number {
  return scoreCompanyNameAgainstProfile(undefined, companyName, row.description);
}
export { meaningfulBrandTokens, scoreCompanyNameAgainstProfile, isVerifiedStockMatch };
async function getUsSymbolsCached(): Promise<UsSymbolRow[]> {
  if (usSymbolsCache && Date.now() - usSymbolsCache.fetchedAt < US_SYMBOLS_CACHE_TTL_MS) {
    return usSymbolsCache.rows;
  }
  const {
    data,
    status
  } = await finnhubGet<UsSymbolRow[]>("stock/symbol", {
    exchange: "US"
  });
  if (status !== 200 || !Array.isArray(data)) {
    return usSymbolsCache?.rows ?? [];
  }
  usSymbolsCache = {
    fetchedAt: Date.now(),
    rows: data
  };
  return data;
}
async function findUsSymbolCandidates(companyName: string): Promise<SymbolCandidate[]> {
  const rows = await getUsSymbolsCached();
  return rows.map(row => ({
    row,
    score: scoreUsSymbolRow(row, companyName)
  })).filter((item): item is {
    row: UsSymbolRow;
    score: number;
  } => Boolean(item.row.symbol) && item.score > 0).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.row.symbol!.length - b.row.symbol!.length;
  }).slice(0, 6).map(item => ({
    symbol: item.row.symbol!.trim(),
    searchDescription: item.row.description,
    source: "us-list" as const
  }));
}
function hasUsableMarketData(profile: ProfileResponse | null, quote: QuoteResponse | null): boolean {
  const sharePrice = quote?.c ?? null;
  const hasQuote = sharePrice != null && sharePrice > 0;
  const hasProfile = Boolean(profile?.name) || Boolean(profile?.ticker) || profile?.marketCapitalization != null || Boolean(profile?.exchange);
  return hasQuote && hasProfile;
}
async function loadMarketDataForSymbol(symbol: string): Promise<{
  profile: ProfileResponse | null;
  quote: QuoteResponse | null;
  status: number;
}> {
  const [profileRes, quoteRes] = await Promise.all([finnhubGet<ProfileResponse>("stock/profile2", {
    symbol
  }), finnhubGet<QuoteResponse>("quote", {
    symbol
  })]);
  const blocked = profileRes.status === 403 || quoteRes.status === 403;
  return {
    profile: profileRes.data,
    quote: quoteRes.data,
    status: blocked ? 403 : Math.max(profileRes.status, quoteRes.status)
  };
}
async function loadStockMetrics(symbol: string): Promise<MetricResponse["metric"] | null> {
  const {
    data,
    status
  } = await finnhubGet<MetricResponse>("stock/metric", {
    symbol,
    metric: "all"
  });
  if (status !== 200 || !data?.metric) return null;
  return data.metric;
}
export async function fetchFinnhubMarketDataForSymbol(symbol: string, searchDescription?: string): Promise<FinnhubMarketData> {
  const empty = emptyMarketData();
  if (!finnhubToken()) return empty;
  const quoteSymbol = symbol.trim().toUpperCase();
  if (!quoteSymbol) return empty;
  const attempt = await loadMarketDataForSymbol(quoteSymbol);
  if (!hasUsableMarketData(attempt.profile, attempt.quote)) {
    return empty;
  }
  const metrics = await loadStockMetrics(quoteSymbol);
  return buildMarketDataResult({
    quoteSymbol,
    searchDescription,
    profile: attempt.profile!,
    quote: attempt.quote!,
    metrics
  });
}
function emptyMarketData(): FinnhubMarketData {
  return {
    ticker: null,
    stock_symbol: null,
    exchange: null,
    stock_currency: null,
    market_cap: null,
    share_price: null,
    share_price_change_pct: null,
    stock_change_5d_pct: null,
    stock_change_3m_pct: null,
    stock_change_12m_pct: null,
    stock_52w_high: null,
    stock_52w_low: null,
    stock_beta: null,
    stock_sparkline: null,
    market_data_as_of: null,
    quote_company_name: null,
    quote_company_weburl: null
  };
}
function buildMarketDataResult(opts: {
  quoteSymbol: string;
  searchDescription?: string;
  profile: ProfileResponse;
  quote: QuoteResponse;
  metrics: MetricResponse["metric"] | null;
}): FinnhubMarketData {
  const sharePrice = opts.quote.c ?? null;
  const priorClose = opts.quote.pc ?? null;
  let changePct = opts.quote.dp ?? null;
  if (changePct == null && sharePrice != null && priorClose != null && priorClose !== 0) {
    changePct = (sharePrice - priorClose) / priorClose * 100;
  }
  const marketCapRaw = opts.profile.marketCapitalization;
  const marketCap = marketCapRaw != null && !Number.isNaN(Number(marketCapRaw)) ? Math.round(Number(marketCapRaw) * 1_000_000) : null;
  const change5d = opts.metrics?.["5DayPriceReturnDaily"] ?? null;
  const change3m = opts.metrics?.["13WeekPriceReturnDaily"] ?? null;
  const change6m = opts.metrics?.["26WeekPriceReturnDaily"] ?? null;
  const changeYtd = opts.metrics?.["yearToDatePriceReturnDaily"] ?? null;
  const change12m = opts.metrics?.["52WeekPriceReturnDaily"] ?? null;
  const high52w = opts.metrics?.["52WeekHigh"] ?? null;
  const low52w = opts.metrics?.["52WeekLow"] ?? null;
  const beta = opts.metrics?.beta ?? null;
  const rangeHigh = stockRangeIsConsistent(sharePrice, low52w, high52w) ? high52w : null;
  const rangeLow = stockRangeIsConsistent(sharePrice, low52w, high52w) ? low52w : null;
  const chartPayload = sharePrice != null ? buildStockChartPayload({
    sharePrice,
    change5d,
    change3m,
    change6m,
    changeYtd,
    change12m
  }) : null;
  const quoteSymbol = opts.quoteSymbol.toUpperCase();
  const isUsQuote = isUsQuoteSymbol(quoteSymbol);
  const profileTicker = opts.profile.ticker?.toUpperCase() ?? null;
  return {
    ticker: isUsQuote ? profileTicker ?? quoteSymbol : quoteSymbol,
    stock_symbol: quoteSymbol,
    exchange: isUsQuote ? inferUsListingExchange(quoteSymbol, opts.searchDescription) : opts.profile.exchange ?? null,
    stock_currency: isUsQuote ? "USD" : opts.profile.currency?.toUpperCase() ?? null,
    market_cap: marketCap,
    share_price: sharePrice,
    share_price_change_pct: changePct,
    stock_change_5d_pct: change5d,
    stock_change_3m_pct: change3m,
    stock_change_12m_pct: change12m,
    stock_52w_high: rangeHigh,
    stock_52w_low: rangeLow,
    stock_beta: beta,
    stock_sparkline: chartPayload,
    market_data_as_of: new Date().toISOString(),
    quote_company_name: opts.profile.name ?? null,
    quote_company_weburl: opts.profile.weburl ?? null
  };
}
export async function collectFinnhubSymbolCandidates(opts: {
  domain?: string | null;
  companyName?: string | null;
  ticker?: string | null;
}): Promise<SymbolCandidate[]> {
  const explicitTicker = opts.ticker?.trim().toUpperCase();
  const companyName = opts.companyName?.trim();
  if (explicitTicker) {
    return [{
      symbol: explicitTicker,
      searchDescription: companyName ?? undefined,
      source: "search"
    }];
  }
  if (!companyName) return [];
  const search = await finnhubGet<SearchResponse>("search", {
    q: companyName
  });
  const searchCandidates: SymbolCandidate[] = (search.data?.result ?? []).slice(0, 8).flatMap(row => {
    const symbol = row.symbol?.trim();
    if (!symbol) return [];
    if (scoreFinnhubSearchResult(row, companyName) <= 0) return [];
    return [{
      symbol,
      searchDescription: row.description,
      source: "search" as const
    }];
  });
  const merged = new Map<string, SymbolCandidate>();
  for (const candidate of searchCandidates) {
    merged.set(candidate.symbol, candidate);
  }
  if (meaningfulBrandTokens(companyName).length > 0) {
    for (const candidate of await findUsSymbolCandidates(companyName)) {
      if (!merged.has(candidate.symbol)) {
        merged.set(candidate.symbol, candidate);
      }
    }
  }
  return [...merged.values()];
}
function scoreVerifiedQuoteCandidate(candidate: SymbolCandidate, companyName: string, domain: string | null | undefined, profileWeburl?: string | null): number {
  const desc = candidate.searchDescription?.toUpperCase() ?? "";
  let score = scoreFinnhubSearchResult({
    description: candidate.searchDescription,
    symbol: candidate.symbol
  }, companyName);
  if (profileWeburl && domainMatchesProfile(profileWeburl, domain)) {
    score += 250;
  }
  if (desc.includes("UNSPON ADR")) score += 100;
  if (desc.includes("SPON ADR") || desc.includes("SP ADR") || desc.includes("SPONSORED ADR")) {
    score += 80;
  }
  if (candidate.symbol.length === 5 && candidate.symbol.endsWith("Y")) score += 30;
  if (candidate.symbol.length === 5 && candidate.symbol.endsWith("F")) score -= 25;
  if (candidate.symbol.length <= 4) score += 5;
  return score;
}
export async function resolveFinnhubTicker(opts: {
  domain?: string | null;
  companyName?: string | null;
  ticker?: string | null;
}): Promise<string | null> {
  const data = await fetchFinnhubMarketData(opts);
  return data.stock_symbol ?? data.ticker;
}
export async function fetchFinnhubMarketData(opts: {
  domain?: string | null;
  companyName?: string | null;
  ticker?: string | null;
}): Promise<FinnhubMarketData> {
  const empty = emptyMarketData();
  if (!finnhubToken()) return empty;
  const manualTicker = opts.ticker?.trim().toUpperCase();
  if (manualTicker) {
    return fetchFinnhubMarketDataForSymbol(manualTicker, opts.companyName ?? undefined);
  }
  const companyName = opts.companyName?.trim();
  if (!companyName) return empty;
  const lookup = resolveStockParentLookup(companyName, opts.domain);
  const candidates = await collectFinnhubSymbolCandidates({
    companyName: lookup.searchName,
    domain: opts.domain,
    ticker: lookup.explicitTicker ?? undefined
  });
  if (candidates.length === 0) return empty;
  const verifyCompanyName = lookup.parentCompanyName ?? companyName;
  const verifyDomain = lookup.parentCompanyName ? null : opts.domain;
  const ordered = [...candidates].sort((a, b) => {
    const aUs = !a.symbol.includes(".") ? 1 : 0;
    const bUs = !b.symbol.includes(".") ? 1 : 0;
    return bUs - aUs;
  });
  let bestMatch: {
    candidate: SymbolCandidate;
    profile: ProfileResponse;
    quote: QuoteResponse;
  } | null = null;
  let bestScore = -1;
  for (const candidate of ordered) {
    const attempt = await loadMarketDataForSymbol(candidate.symbol);
    if (!hasUsableMarketData(attempt.profile, attempt.quote)) {
      continue;
    }
    const verified = isVerifiedStockMatch({
      companyName: verifyCompanyName,
      domain: verifyDomain,
      profileName: attempt.profile?.name,
      profileWeburl: attempt.profile?.weburl,
      searchDescription: candidate.searchDescription
    });
    if (!verified) {
      continue;
    }
    const score = scoreVerifiedQuoteCandidate(candidate, verifyCompanyName, verifyDomain, attempt.profile?.weburl);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        candidate,
        profile: attempt.profile!,
        quote: attempt.quote!
      };
    }
  }
  if (bestMatch) {
    const metrics = await loadStockMetrics(bestMatch.candidate.symbol);
    return buildMarketDataResult({
      quoteSymbol: bestMatch.candidate.symbol,
      searchDescription: bestMatch.candidate.searchDescription,
      profile: bestMatch.profile,
      quote: bestMatch.quote,
      metrics
    });
  }
  return empty;
}