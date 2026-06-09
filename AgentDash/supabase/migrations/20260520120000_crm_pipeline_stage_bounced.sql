-- Add "bounced" kanban stage for invalid / bounced outreach emails

ALTER TABLE public.crm_companies_pipeline
  DROP CONSTRAINT IF EXISTS crm_companies_pipeline_pipeline_stage_check;

ALTER TABLE public.crm_companies_pipeline
  ADD CONSTRAINT crm_companies_pipeline_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'target', 'research', 'drafting',
    'outreach', 'bounced', 'follow_up', 'ghost',
    'in_progress', 'closed'
  ));
