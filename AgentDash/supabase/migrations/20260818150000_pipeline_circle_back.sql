-- Circle-back reminder: pause the sequence when a prospect says "check back in a couple months"
ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS circle_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS circle_back_note text;

COMMENT ON COLUMN public.crm_companies_pipeline.circle_back_at IS
  'When to resume outreach after a prospect asked to circle back later. Sequence stays paused until this time.';
COMMENT ON COLUMN public.crm_companies_pipeline.circle_back_note IS
  'Optional note from the reply (e.g. budget cycle, Q4, after launch).';

ALTER TABLE public.crm_companies_pipeline
  DROP CONSTRAINT IF EXISTS crm_companies_pipeline_next_action_check;

ALTER TABLE public.crm_companies_pipeline
  ADD CONSTRAINT crm_companies_pipeline_next_action_check
  CHECK (next_action IS NULL OR next_action IN ('email', 'linkedin', 'call', 'cool', 'circle_back'));

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_circle_back_at
  ON public.crm_companies_pipeline (circle_back_at)
  WHERE circle_back_at IS NOT NULL AND archived = false;
