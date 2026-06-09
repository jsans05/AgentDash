-- Unify crm_companies_pipeline: backfill pipeline_stage from funnel_stage (max progress wins).

CREATE OR REPLACE FUNCTION public._crm_stage_ordinal(stage text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE stage
    WHEN 'target' THEN 0 WHEN 'idea' THEN 0
    WHEN 'research' THEN 1
    WHEN 'drafting' THEN 2
    WHEN 'outreach' THEN 3 WHEN 'contacted' THEN 3 WHEN 'bounced' THEN 3
    WHEN 'follow_up' THEN 4 WHEN 'paused' THEN 4
    WHEN 'ghost' THEN 5 WHEN 'lost' THEN 5
    WHEN 'in_progress' THEN 6 WHEN 'negotiating' THEN 6
    WHEN 'closed' THEN 7 WHEN 'won' THEN 7
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public._crm_ordinal_to_pipeline(ord int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE ord
    WHEN 7 THEN 'closed'
    WHEN 6 THEN 'in_progress'
    WHEN 5 THEN 'ghost'
    WHEN 4 THEN 'follow_up'
    WHEN 3 THEN 'outreach'
    WHEN 2 THEN 'drafting'
    WHEN 1 THEN 'research'
    ELSE 'target'
  END;
$$;

UPDATE public.crm_companies_pipeline
SET pipeline_stage = public._crm_ordinal_to_pipeline(
  GREATEST(
    public._crm_stage_ordinal(pipeline_stage),
    public._crm_stage_ordinal(funnel_stage)
  )
)
WHERE pipeline_stage IS NOT NULL;

UPDATE public.crm_companies_pipeline
SET funnel_stage = CASE pipeline_stage
  WHEN 'target' THEN 'idea'
  WHEN 'research' THEN 'research'
  WHEN 'drafting' THEN 'research'
  WHEN 'outreach' THEN 'contacted'
  WHEN 'bounced' THEN 'contacted'
  WHEN 'follow_up' THEN 'paused'
  WHEN 'ghost' THEN 'lost'
  WHEN 'in_progress' THEN 'negotiating'
  WHEN 'closed' THEN 'won'
  ELSE funnel_stage
END;

DROP FUNCTION IF EXISTS public._crm_stage_ordinal(text);
DROP FUNCTION IF EXISTS public._crm_ordinal_to_pipeline(int);
