-- =============================================================================
-- Company profiles + pipeline relevant people (including LinkedIn-only contacts)
-- =============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS support_email text;

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS relevant_people jsonb NOT NULL DEFAULT '[]'::jsonb;
