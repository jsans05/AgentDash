-- Contact of record + active sequence conversation contact on pipeline cards.
ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS contact_of_record_id uuid REFERENCES public.crm_contacts(contact_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_contact_id uuid REFERENCES public.crm_contacts(contact_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.crm_companies_pipeline.contact_of_record_id IS
  'Primary CRM contact for this company card (contact of record).';

COMMENT ON COLUMN public.crm_companies_pipeline.sequence_contact_id IS
  'CRM contact currently being sequenced / talked to; defaults to contact_of_record_id when null.';

CREATE INDEX IF NOT EXISTS crm_companies_pipeline_contact_of_record_id_idx
  ON public.crm_companies_pipeline (contact_of_record_id)
  WHERE contact_of_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_companies_pipeline_sequence_contact_id_idx
  ON public.crm_companies_pipeline (sequence_contact_id)
  WHERE sequence_contact_id IS NOT NULL;
