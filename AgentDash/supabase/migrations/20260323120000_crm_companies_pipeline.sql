-- =============================================================================
-- CRM company pipeline for AI prospecting workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.crm_companies_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'promoted_to_crm')),
  support_email text,
  contact_emails text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  sent_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, created_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_owner_status
  ON public.crm_companies_pipeline(created_by_user_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_company
  ON public.crm_companies_pipeline(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_pipeline_sent_at
  ON public.crm_companies_pipeline(sent_at DESC);

COMMENT ON TABLE public.crm_companies_pipeline IS
  'AI prospecting company workflow: in progress email finding and promotion into CRM contacts.';

DROP TRIGGER IF EXISTS crm_companies_pipeline_updated_at ON public.crm_companies_pipeline;
CREATE TRIGGER crm_companies_pipeline_updated_at
BEFORE UPDATE ON public.crm_companies_pipeline
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_companies_pipeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_companies_pipeline_select ON public.crm_companies_pipeline;
DROP POLICY IF EXISTS crm_companies_pipeline_insert ON public.crm_companies_pipeline;
DROP POLICY IF EXISTS crm_companies_pipeline_update ON public.crm_companies_pipeline;
DROP POLICY IF EXISTS crm_companies_pipeline_delete ON public.crm_companies_pipeline;

CREATE POLICY crm_companies_pipeline_select ON public.crm_companies_pipeline
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR created_by_user_id = auth.uid()
  );

CREATE POLICY crm_companies_pipeline_insert ON public.crm_companies_pipeline
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );

CREATE POLICY crm_companies_pipeline_update ON public.crm_companies_pipeline
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );

CREATE POLICY crm_companies_pipeline_delete ON public.crm_companies_pipeline
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );
