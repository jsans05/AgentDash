-- Apollo enrichment cache for Market Intel brands (revenue, funding, headcount trends, news)

CREATE TABLE IF NOT EXISTS public.market_intel_brand_enrichment (
  company_name_normalized text PRIMARY KEY,
  display_name text NOT NULL,
  domain text,
  apollo_organization_id text,
  annual_revenue bigint,
  annual_revenue_printed text,
  total_funding bigint,
  total_funding_printed text,
  latest_funding_stage text,
  latest_funding_round_date timestamptz,
  funding_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_num_employees integer,
  industry text,
  headcount_six_month_growth numeric,
  headcount_twelve_month_growth numeric,
  headcount_twenty_four_month_growth numeric,
  departmental_head_count jsonb,
  news_articles jsonb NOT NULL DEFAULT '[]'::jsonb,
  enriched_at timestamptz NOT NULL DEFAULT now(),
  enriched_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_market_intel_brand_enrichment_enriched_at
  ON public.market_intel_brand_enrichment (enriched_at DESC);

ALTER TABLE public.market_intel_brand_enrichment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_intel_brand_enrichment_admin_sales_read"
  ON public.market_intel_brand_enrichment;
CREATE POLICY "market_intel_brand_enrichment_admin_sales_read"
  ON public.market_intel_brand_enrichment
  FOR SELECT USING (public.is_admin() OR public.is_sales());

COMMENT ON TABLE public.market_intel_brand_enrichment IS
  'Apollo firmographic enrichment for aggregated market intel brands.';
