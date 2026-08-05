const GENERIC_BRAND_TOKENS = new Set(["filters", "filter", "group", "global", "international", "america", "american", "north", "south", "east", "west", "company", "companies", "corp", "corporation", "inc", "incorporated", "ltd", "limited", "holdings", "holding", "services", "service", "industries", "industry", "products", "product", "brands", "brand", "motors", "motor", "auto", "parts"]);
export const MIN_STOCK_NAME_MATCH_SCORE = 55;
export function meaningfulBrandTokens(companyName: string): string[] {
  const full = companyName.trim().toLowerCase();
  const parts = full.split(/\s+/).map(part => part.replace(/[^a-z0-9]/g, "")).filter(part => part.length >= 3 && !GENERIC_BRAND_TOKENS.has(part));
  const tokens = new Set<string>();
  if (full.length >= 4 && !GENERIC_BRAND_TOKENS.has(full)) {
    tokens.add(full);
  }
  for (const part of parts) {
    tokens.add(part);
  }
  return [...tokens];
}
export function scoreCompanyNameAgainstProfile(profileName: string | undefined, companyName: string, searchDescription?: string): number {
  const brand = companyName.trim().toLowerCase();
  if (!brand) return 0;
  const targets = [profileName, searchDescription].filter((value): value is string => Boolean(value?.trim())).map(value => value.trim().toLowerCase());
  const tokens = meaningfulBrandTokens(companyName);
  let best = 0;
  for (const target of targets) {
    if (target === brand) {
      best = Math.max(best, 100);
      continue;
    }
    if (target.startsWith(`${brand} `) || target.startsWith(`${brand},`)) {
      best = Math.max(best, 90);
      continue;
    }
    if (brand.length >= 5 && target.includes(brand)) {
      best = Math.max(best, 80);
    }
    if (tokens.length >= 2 && tokens.every(token => target.includes(token))) {
      best = Math.max(best, 85);
      continue;
    }
    if (tokens.length === 1) {
      const token = tokens[0];
      if (token.length >= 5 && target.includes(token)) {
        best = Math.max(best, 70);
      } else if (token.length >= 4 && (target.startsWith(`${token} `) || target === token)) {
        best = Math.max(best, 65);
      } else if (target.startsWith(token) && (target.length === token.length || [".", "-", " ", ","].includes(target[token.length] ?? ""))) {
        best = Math.max(best, 75);
      }
    }
  }
  return best;
}
const STOCK_DESCRIPTION_MISMATCH_TERMS = ["BIOTECH", "BIOTECHNOLOGY", "THERAPEUTICS", "PHARMACEUTICAL", "PHARMA", "FINANCIAL", "BANK", "INSURANCE", "REIT", "MORTGAGE"];
export function stockDescriptionMismatch(companyName: string, description: string | null | undefined): boolean {
  const desc = description?.trim().toUpperCase();
  if (!desc) return false;
  const tokens = meaningfulBrandTokens(companyName);
  if (tokens.length !== 1 || tokens[0].length > 5) return false;
  const token = tokens[0].toUpperCase();
  if (!desc.includes(token)) return false;
  return STOCK_DESCRIPTION_MISMATCH_TERMS.some(term => desc.includes(term));
}
export function isVerifiedStockMatch(opts: {
  companyName: string;
  domain?: string | null;
  profileName?: string | null;
  profileWeburl?: string | null;
  searchDescription?: string | null;
}): boolean {
  if (opts.profileWeburl && domainMatchesProfile(opts.profileWeburl, opts.domain)) {
    return true;
  }
  const description = opts.searchDescription ?? opts.profileName;
  if (stockDescriptionMismatch(opts.companyName, description)) {
    return false;
  }
  return scoreCompanyNameAgainstProfile(opts.profileName ?? undefined, opts.companyName, opts.searchDescription ?? undefined) >= MIN_STOCK_NAME_MATCH_SCORE;
}
export function domainMatchesProfile(profileWeburl: string | undefined, targetDomain: string | null | undefined): boolean {
  return domainMatches(profileWeburl, targetDomain);
}
export function normalizeDomainHost(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const host = new URL(value.startsWith("http") ? value : `https://${value}`).hostname;
    return host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.replace(/^www\./i, "").toLowerCase();
  }
}
export function domainMatches(profileWeburl: string | undefined, targetDomain: string | null | undefined): boolean {
  const profileHost = normalizeDomainHost(profileWeburl);
  const target = normalizeDomainHost(targetDomain);
  if (!profileHost || !target) return false;
  if (profileHost === target) return true;
  const profileRoot = profileHost.split(".").slice(-2).join(".");
  const targetRoot = target.split(".").slice(-2).join(".");
  return profileRoot === targetRoot;
}
export function isUsQuoteSymbol(symbol: string | null | undefined): boolean {
  const value = symbol?.trim();
  return Boolean(value) && !value!.includes(".");
}
const NON_US_GOOGLE_EXCHANGE_CODES = new Set(["TYO", "LON", "EPA", "EURONEXT", "WSE"]);
export function inferUsListingExchange(symbol: string, searchDescription?: string | null): string {
  const upper = symbol.trim().toUpperCase();
  const desc = searchDescription?.toUpperCase() ?? "";
  if (desc.includes("UNSPON")) return "OTC MARKETS";
  if (desc.includes("OTC") || desc.includes("PINK")) return "OTC MARKETS";
  if (upper.length === 5 && (upper.endsWith("Y") || upper.endsWith("F"))) return "OTC MARKETS";
  if (desc.includes("NASDAQ")) return "NASDAQ GLOBAL SELECT";
  if (desc.includes("SPON") || desc.includes("SP ADR") || desc.includes("SPONSORED") || desc.includes("NY REG")) {
    return "NEW YORK STOCK EXCHANGE, INC.";
  }
  return "NEW YORK STOCK EXCHANGE, INC.";
}
export function isLikelyOtcUsSymbol(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  return upper.length === 5 && (upper.endsWith("Y") || upper.endsWith("F"));
}
export function resolveGoogleFinanceExchange(symbol: string, exchange: string | null | undefined): string | null {
  if (!isUsQuoteSymbol(symbol)) return exchange ?? null;
  const inferred = inferUsListingExchange(symbol);
  if (isLikelyOtcUsSymbol(symbol)) return inferred;
  const code = googleFinanceExchangeCode(exchange);
  if (code && !NON_US_GOOGLE_EXCHANGE_CODES.has(code)) {
    return exchange ?? null;
  }
  return inferred;
}
export function googleFinanceUrl(symbol: string, exchange: string | null | undefined): string {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const resolvedExchange = resolveGoogleFinanceExchange(symbol, exchange);
  const exchangeCode = googleFinanceExchangeCode(resolvedExchange);
  if (exchangeCode) {
    return `https://www.google.com/finance/beta/quote/${encodedSymbol}:${exchangeCode}`;
  }
  return `https://www.google.com/finance/beta/quote/${encodedSymbol}`;
}
export function googleFinanceExchangeCode(exchange: string | null | undefined): string | null {
  if (!exchange?.trim()) return null;
  const value = exchange.toUpperCase();
  if (value.includes("NASDAQ")) return "NASDAQ";
  if (value.includes("NYSE") || value.includes("NEW YORK STOCK EXCHANGE")) return "NYSE";
  if (value.includes("OTC") || value.includes("OOTC")) return "OTCMKTS";
  if (value.includes("EURONEXT") && value.includes("PARIS")) return "EPA";
  if (value.includes("EURONEXT")) return "EURONEXT";
  if (value.includes("TOKYO")) return "TYO";
  if (value.includes("LONDON") || value.includes("LSE")) return "LON";
  if (value.includes("WARSAW")) return "WSE";
  return null;
}