-- =============================================================================
-- CRM contact quick-status and archive fields
-- =============================================================================

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS status_tag text NOT NULL DEFAULT 'none'
    CHECK (status_tag IN ('none', 'green_conversation', 'yellow_authenticated', 'red_bounced')),
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_status_tag ON public.crm_contacts(status_tag);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_archived ON public.crm_contacts(archived);
