-- Extended firmographics: match metadata, market data, hiring, Meta ads signals

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS match_confidence text,
  ADD COLUMN IF NOT EXISTS match_notes text,
  ADD COLUMN IF NOT EXISTS latest_funding_round_date timestamptz,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS departmental_head_count jsonb,
  ADD COLUMN IF NOT EXISTS ticker text,
  ADD COLUMN IF NOT EXISTS exchange text,
  ADD COLUMN IF NOT EXISTS market_cap bigint,
  ADD COLUMN IF NOT EXISTS share_price numeric,
  ADD COLUMN IF NOT EXISTS share_price_change_pct numeric,
  ADD COLUMN IF NOT EXISTS market_data_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS open_jobs_count integer,
  ADD COLUMN IF NOT EXISTS open_jobs_source text,
  ADD COLUMN IF NOT EXISTS open_jobs_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS facebook_page_url text,
  ADD COLUMN IF NOT EXISTS meta_page_id text,
  ADD COLUMN IF NOT EXISTS meta_ads_library_url text,
  ADD COLUMN IF NOT EXISTS meta_ads_latest_start timestamptz,
  ADD COLUMN IF NOT EXISTS meta_ads_active_count integer,
  ADD COLUMN IF NOT EXISTS meta_ads_status text,
  ADD COLUMN IF NOT EXISTS meta_ads_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS spend_readiness_score integer,
  ADD COLUMN IF NOT EXISTS spend_readiness_label text;

ALTER TABLE public.market_intel_brand_enrichment
  ADD COLUMN IF NOT EXISTS match_confidence text,
  ADD COLUMN IF NOT EXISTS match_notes text,
  ADD COLUMN IF NOT EXISTS ticker text,
  ADD COLUMN IF NOT EXISTS exchange text,
  ADD COLUMN IF NOT EXISTS market_cap bigint,
  ADD COLUMN IF NOT EXISTS share_price numeric,
  ADD COLUMN IF NOT EXISTS share_price_change_pct numeric,
  ADD COLUMN IF NOT EXISTS market_data_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS open_jobs_count integer,
  ADD COLUMN IF NOT EXISTS open_jobs_source text,
  ADD COLUMN IF NOT EXISTS open_jobs_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS facebook_page_url text,
  ADD COLUMN IF NOT EXISTS meta_page_id text,
  ADD COLUMN IF NOT EXISTS meta_ads_library_url text,
  ADD COLUMN IF NOT EXISTS meta_ads_latest_start timestamptz,
  ADD COLUMN IF NOT EXISTS meta_ads_active_count integer,
  ADD COLUMN IF NOT EXISTS meta_ads_status text,
  ADD COLUMN IF NOT EXISTS meta_ads_as_of timestamptz,
  ADD COLUMN IF NOT EXISTS spend_readiness_score integer,
  ADD COLUMN IF NOT EXISTS spend_readiness_label text;

COMMENT ON COLUMN public.companies.spend_readiness_label IS
  'Heuristic spend-readiness estimate from revenue, funding, hiring, stock, Meta ads.';
