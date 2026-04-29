-- =============================================================================
-- Athlete target list support
--   1. Rename crm_companies_pipeline.research_notes -> company_description
--      (AI-generated via web search, surfaced on the CRM card + target list)
--   2. Add crm_companies_pipeline.personal_notes  (agent-authored freeform notes)
--   3. Add companies.hq_phone                     ("HQ Number" in target list)
--   4. Add crm_contacts.phone                     ("Number" in target list)
-- =============================================================================

-- 1) research_notes -> company_description
ALTER TABLE public.crm_companies_pipeline
  RENAME COLUMN research_notes TO company_description;

COMMENT ON COLUMN public.crm_companies_pipeline.company_description IS
  'Company Description shown on the target list. May be AI-generated via web search.';

-- 2) personal_notes (per-pipeline-card, per-agent)
ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS personal_notes text;

COMMENT ON COLUMN public.crm_companies_pipeline.personal_notes IS
  'Agent-authored personal notes about this company (shown as Personal Notes on the target list).';

-- 3) HQ phone on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hq_phone text;

COMMENT ON COLUMN public.companies.hq_phone IS
  'Headquarters / main switchboard phone number ("HQ Number" on the target list).';

-- 4) Contact phone on crm_contacts
ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.crm_contacts.phone IS
  'Direct phone number for this contact ("Number" on the target list).';
