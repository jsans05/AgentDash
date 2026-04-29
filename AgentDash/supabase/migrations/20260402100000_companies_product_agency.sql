-- Company-level CRM fields: product category + agency representation

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS product_category text,
  ADD COLUMN IF NOT EXISTS managed_by_agency boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agency_name text;

COMMENT ON COLUMN public.companies.product_category IS 'Pipeline: primary product category for outreach (e.g. energy drink, apparel).';
COMMENT ON COLUMN public.companies.managed_by_agency IS 'Pipeline: brand is represented by an external agency.';
COMMENT ON COLUMN public.companies.agency_name IS 'Pipeline: agency name when managed_by_agency is true.';
