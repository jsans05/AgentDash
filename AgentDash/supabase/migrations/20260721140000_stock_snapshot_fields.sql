ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stock_symbol text,
  ADD COLUMN IF NOT EXISTS stock_currency text,
  ADD COLUMN IF NOT EXISTS stock_change_5d_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_change_3m_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_change_12m_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_52w_high numeric,
  ADD COLUMN IF NOT EXISTS stock_52w_low numeric,
  ADD COLUMN IF NOT EXISTS stock_beta numeric,
  ADD COLUMN IF NOT EXISTS stock_sparkline jsonb;

ALTER TABLE market_intel_brand_enrichment
  ADD COLUMN IF NOT EXISTS stock_symbol text,
  ADD COLUMN IF NOT EXISTS stock_currency text,
  ADD COLUMN IF NOT EXISTS stock_change_5d_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_change_3m_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_change_12m_pct numeric,
  ADD COLUMN IF NOT EXISTS stock_52w_high numeric,
  ADD COLUMN IF NOT EXISTS stock_52w_low numeric,
  ADD COLUMN IF NOT EXISTS stock_beta numeric,
  ADD COLUMN IF NOT EXISTS stock_sparkline jsonb;

COMMENT ON COLUMN companies.stock_symbol IS 'Finnhub quote symbol used for display (often US ADR/OTC).';
COMMENT ON COLUMN companies.stock_sparkline IS 'Approximate price trend points derived from Finnhub metric returns.';
