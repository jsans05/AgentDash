-- Target list / pipeline: store outreach subject separately from body (artifact column "Email Subject").
ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS outreach_email_subject text;

COMMENT ON COLUMN public.crm_companies_pipeline.outreach_email_subject IS
  'Email subject line for target-list outreach (paired with outreach_email body).';
