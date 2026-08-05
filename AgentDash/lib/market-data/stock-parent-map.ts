export type StockParentLookup = {
  searchName: string;
  explicitTicker?: string | null;
  parentCompanyName?: string | null;
};
type StockParentMapping = {
  searchName: string;
  ticker?: string;
};
function normalizeBrandKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
const STOCK_PARENT_BY_KEY: Record<string, StockParentMapping> = {
  chevrolet: {
    searchName: "General Motors",
    ticker: "GM"
  },
  gmc: {
    searchName: "General Motors",
    ticker: "GM"
  },
  buick: {
    searchName: "General Motors",
    ticker: "GM"
  },
  cadillac: {
    searchName: "General Motors",
    ticker: "GM"
  }
};
const STOCK_PARENT_BY_DOMAIN: Record<string, StockParentMapping> = {
  chevrolet: {
    searchName: "General Motors",
    ticker: "GM"
  },
  gmc: {
    searchName: "General Motors",
    ticker: "GM"
  },
  buick: {
    searchName: "General Motors",
    ticker: "GM"
  },
  cadillac: {
    searchName: "General Motors",
    ticker: "GM"
  }
};
export function resolveStockParentLookup(companyName: string, domain?: string | null): StockParentLookup {
  const trimmed = companyName.trim();
  if (!trimmed) {
    return {
      searchName: trimmed,
      explicitTicker: null,
      parentCompanyName: null
    };
  }
  const brandKey = normalizeBrandKey(trimmed);
  const domainKey = domain ? normalizeBrandKey(domain.replace(/^www\./i, "").split(".")[0] ?? "") : "";
  const mapping = STOCK_PARENT_BY_KEY[brandKey] ?? (domainKey ? STOCK_PARENT_BY_DOMAIN[domainKey] : undefined);
  if (!mapping) {
    return {
      searchName: trimmed,
      explicitTicker: null,
      parentCompanyName: null
    };
  }
  return {
    searchName: mapping.searchName,
    explicitTicker: mapping.ticker ?? null,
    parentCompanyName: mapping.searchName
  };
}