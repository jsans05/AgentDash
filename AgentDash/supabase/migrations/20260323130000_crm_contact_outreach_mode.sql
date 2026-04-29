-- =============================================================================
-- CRM contact outreach mode for non-email workflows
-- =============================================================================

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS outreach_mode text NOT NULL DEFAULT 'email'
    CHECK (outreach_mode IN ('email', 'linkedin', 'other'));

CREATE INDEX IF NOT EXISTS idx_crm_contacts_outreach_mode ON public.crm_contacts(outreach_mode);
