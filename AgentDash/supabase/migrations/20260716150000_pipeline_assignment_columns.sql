-- =============================================================================
-- Pipeline assignment audit: who handed a card off and when
-- =============================================================================

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS assigned_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_assigned_by
  ON public.crm_companies_pipeline(assigned_by_user_id)
  WHERE assigned_by_user_id IS NOT NULL;

COMMENT ON COLUMN public.crm_companies_pipeline.assigned_by_user_id IS
  'User who last assigned this card to the current owner (created_by_user_id).';
COMMENT ON COLUMN public.crm_companies_pipeline.assigned_at IS
  'When the card was last assigned to the current owner.';
