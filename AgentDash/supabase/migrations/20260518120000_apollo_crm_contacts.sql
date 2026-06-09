-- Apollo.io integration: external IDs, reveal status, usage audit

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS apollo_organization_id text;

COMMENT ON COLUMN public.companies.apollo_organization_id IS
  'Apollo organization_id from Organization Search; used to scope People API Search.';

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS apollo_person_id text,
  ADD COLUMN IF NOT EXISTS apollo_reveal_status text;

COMMENT ON COLUMN public.crm_contacts.apollo_person_id IS
  'Apollo person id from mixed_people/api_search.';
COMMENT ON COLUMN public.crm_contacts.apollo_reveal_status IS
  'pending = found via Apollo, email not revealed; revealed = people/match completed; NULL = manual contact.';

CREATE INDEX IF NOT EXISTS idx_crm_contacts_apollo_person
  ON public.crm_contacts(created_by_user_id, apollo_person_id)
  WHERE apollo_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_apollo_reveal_status
  ON public.crm_contacts(apollo_reveal_status)
  WHERE apollo_reveal_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.apollo_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  company_id uuid REFERENCES public.companies(company_id) ON DELETE SET NULL,
  apollo_person_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apollo_api_usage_user_created
  ON public.apollo_api_usage(user_id, created_at DESC);

ALTER TABLE public.apollo_api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY apollo_api_usage_select_own ON public.apollo_api_usage
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY apollo_api_usage_insert_own ON public.apollo_api_usage
  FOR INSERT
  WITH CHECK (user_id = auth.uid());
