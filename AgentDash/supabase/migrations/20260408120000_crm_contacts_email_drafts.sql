-- Per-contact saved email drafts (e.g. AI outreach from pipeline chat)

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS email_drafts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.crm_contacts.email_drafts IS
  'Outreach email drafts for this contact: array of {label?, subject?, body, created_at, athlete_id?}';
