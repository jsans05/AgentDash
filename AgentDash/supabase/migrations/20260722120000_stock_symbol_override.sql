ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stock_symbol_override text;

ALTER TABLE market_intel_brand_enrichment
  ADD COLUMN IF NOT EXISTS stock_symbol_override text;

COMMENT ON COLUMN companies.stock_symbol_override IS 'User-confirmed quote symbol; auto stock lookup uses this instead of search.';
COMMENT ON COLUMN market_intel_brand_enrichment.stock_symbol_override IS 'User-confirmed quote symbol; auto stock lookup uses this instead of search.';
