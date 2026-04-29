-- =============================================================================
-- CRM company pipeline funnel fields for manual brand ideation workflow
-- =============================================================================

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS funnel_stage text NOT NULL DEFAULT 'idea',
  ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS next_follow_up_at date,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_companies_pipeline_funnel_stage_check'
  ) THEN
    ALTER TABLE public.crm_companies_pipeline
      ADD CONSTRAINT crm_companies_pipeline_funnel_stage_check
      CHECK (funnel_stage IN ('idea', 'research', 'contacted', 'negotiating', 'paused', 'won', 'lost'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_companies_pipeline_priority_check'
  ) THEN
    ALTER TABLE public.crm_companies_pipeline
      ADD CONSTRAINT crm_companies_pipeline_priority_check
      CHECK (priority BETWEEN 1 AND 3);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_owner_archived_stage
  ON public.crm_companies_pipeline(created_by_user_id, archived, funnel_stage);

CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_owner_follow_up
  ON public.crm_companies_pipeline(created_by_user_id, next_follow_up_at);
