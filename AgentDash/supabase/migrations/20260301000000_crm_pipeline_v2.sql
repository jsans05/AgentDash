-- CRM pipeline v2: Kanban stages and deal/draft fields

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'target'
    CHECK (pipeline_stage IN (
      'target', 'research', 'drafting',
      'outreach', 'follow_up', 'ghost',
      'in_progress', 'closed'
    )),
  ADD COLUMN IF NOT EXISTS outreach_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS idea_notes text,
  ADD COLUMN IF NOT EXISTS research_notes text,
  ADD COLUMN IF NOT EXISTS past_partnerships text,
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS support_email_v2 text,
  ADD COLUMN IF NOT EXISTS cmo_email text,
  ADD COLUMN IF NOT EXISTS partnerships_email text,
  ADD COLUMN IF NOT EXISTS experiential_email text,
  ADD COLUMN IF NOT EXISTS potential_athletes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS todos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_value numeric,
  ADD COLUMN IF NOT EXISTS closed_athlete_id uuid REFERENCES public.athletes(athlete_id),
  ADD COLUMN IF NOT EXISTS closed_media_url text,
  ADD COLUMN IF NOT EXISTS draft_messages jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stage_user
  ON public.crm_companies_pipeline(created_by_user_id, pipeline_stage);

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_outreach_at
  ON public.crm_companies_pipeline(outreach_at)
  WHERE outreach_at IS NOT NULL;
