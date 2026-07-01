-- Firmographic fields on companies (shared across athlete + consulting target lists)

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS annual_revenue bigint,
  ADD COLUMN IF NOT EXISTS annual_revenue_printed text,
  ADD COLUMN IF NOT EXISTS total_funding bigint,
  ADD COLUMN IF NOT EXISTS total_funding_printed text,
  ADD COLUMN IF NOT EXISTS latest_funding_stage text,
  ADD COLUMN IF NOT EXISTS estimated_num_employees integer,
  ADD COLUMN IF NOT EXISTS headcount_six_month_growth numeric,
  ADD COLUMN IF NOT EXISTS headcount_twelve_month_growth numeric,
  ADD COLUMN IF NOT EXISTS headcount_twenty_four_month_growth numeric,
  ADD COLUMN IF NOT EXISTS firmographics_enriched_at timestamptz;

COMMENT ON COLUMN public.companies.annual_revenue IS
  'Apollo annual revenue (numeric). Display annual_revenue_printed when set.';
COMMENT ON COLUMN public.companies.firmographics_enriched_at IS
  'When Apollo firmographics were last written to this company row.';
