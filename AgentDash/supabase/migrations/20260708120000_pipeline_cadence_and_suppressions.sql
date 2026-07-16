-- Pipeline cadence fields, email suppressions, merge research → target

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS follow_up_step smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS follow_up_log jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.crm_companies_pipeline
  DROP CONSTRAINT IF EXISTS crm_companies_pipeline_next_action_check;

ALTER TABLE public.crm_companies_pipeline
  ADD CONSTRAINT crm_companies_pipeline_next_action_check
  CHECK (next_action IS NULL OR next_action IN ('email', 'linkedin', 'call', 'cool'));

COMMENT ON COLUMN public.crm_companies_pipeline.follow_up_step IS
  '0=post-send wait FU1, 1=FU1, 2=FU2, 3=call due, 4=FU3, 5=cooling before ghost';
COMMENT ON COLUMN public.crm_companies_pipeline.next_action IS
  'Next recommended channel: email, linkedin, call, or cool (waiting period)';

-- Promote date-only next_follow_up_at to timestamptz for cron precision
ALTER TABLE public.crm_companies_pipeline
  ALTER COLUMN next_follow_up_at TYPE timestamptz
  USING (
    CASE
      WHEN next_follow_up_at IS NULL THEN NULL
      ELSE next_follow_up_at::timestamptz
    END
  );

-- Merge legacy research stage into target
UPDATE public.crm_companies_pipeline
SET pipeline_stage = 'target'
WHERE pipeline_stage = 'research';

CREATE TABLE IF NOT EXISTS public.crm_email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  reason text,
  company_id uuid REFERENCES public.companies(company_id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.crm_contacts(contact_id) ON DELETE SET NULL,
  pipeline_id uuid REFERENCES public.crm_companies_pipeline(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_normalized, created_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_email_suppressions_user_email
  ON public.crm_email_suppressions (created_by_user_id, email_normalized);

ALTER TABLE public.crm_email_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_email_suppressions_select_own ON public.crm_email_suppressions
  FOR SELECT USING (created_by_user_id = auth.uid());

CREATE POLICY crm_email_suppressions_insert_own ON public.crm_email_suppressions
  FOR INSERT WITH CHECK (created_by_user_id = auth.uid());

-- Backfill cadence from outreach_at (best-effort)
UPDATE public.crm_companies_pipeline p
SET
  last_touch_at = COALESCE(p.last_touch_at, p.outreach_at),
  follow_up_step = CASE
    WHEN p.pipeline_stage = 'ghost' THEN 5
    WHEN p.pipeline_stage IN ('follow_up', 'bounced') AND p.outreach_at IS NOT NULL THEN
      LEAST(
        5,
        GREATEST(
          1,
          FLOOR(EXTRACT(EPOCH FROM (now() - p.outreach_at)) / (7 * 86400))::int
        )
      )
    WHEN p.pipeline_stage = 'outreach' AND p.outreach_at IS NOT NULL THEN 0
    ELSE 0
  END,
  next_action = CASE
    WHEN p.pipeline_stage = 'ghost' THEN 'cool'
    WHEN p.pipeline_stage = 'follow_up' THEN 'email'
    WHEN p.pipeline_stage = 'outreach' AND p.outreach_at IS NOT NULL THEN 'email'
    ELSE NULL
  END,
  next_follow_up_at = CASE
    WHEN p.outreach_at IS NOT NULL AND p.responded_at IS NULL THEN
      p.outreach_at + interval '7 days' * GREATEST(1, LEAST(4,
        CASE
          WHEN p.pipeline_stage = 'ghost' THEN 5
          WHEN p.pipeline_stage = 'follow_up' THEN
            GREATEST(1, FLOOR(EXTRACT(EPOCH FROM (now() - p.outreach_at)) / (7 * 86400))::int + 1)
          ELSE 1
        END
      ))
    ELSE p.next_follow_up_at
  END
WHERE p.outreach_at IS NOT NULL
  AND p.responded_at IS NULL
  AND p.archived = false
  AND p.pipeline_stage IN ('outreach', 'follow_up', 'ghost', 'bounced');
