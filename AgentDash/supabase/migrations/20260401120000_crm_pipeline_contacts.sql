-- Three flexible contact slots (name, role, email) for pipeline research

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS pipeline_contacts jsonb DEFAULT '[
    {"name":"","role":"","email":""},
    {"name":"","role":"","email":""},
    {"name":"","role":"","email":""}
  ]'::jsonb;

-- Copy legacy CMO / partnerships / experiential emails into the three slots when present
UPDATE public.crm_companies_pipeline
SET pipeline_contacts = jsonb_build_array(
  jsonb_build_object('name', '', 'role', '', 'email', COALESCE(NULLIF(TRIM(cmo_email), ''), '')),
  jsonb_build_object('name', '', 'role', '', 'email', COALESCE(NULLIF(TRIM(partnerships_email), ''), '')),
  jsonb_build_object('name', '', 'role', '', 'email', COALESCE(NULLIF(TRIM(experiential_email), ''), ''))
)
WHERE
  (cmo_email IS NOT NULL AND TRIM(cmo_email) != '')
  OR (partnerships_email IS NOT NULL AND TRIM(partnerships_email) != '')
  OR (experiential_email IS NOT NULL AND TRIM(experiential_email) != '');
