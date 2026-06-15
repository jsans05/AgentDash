-- Apollo personal phone reveal (async webhook delivery)

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS apollo_phone_reveal_status text;

COMMENT ON COLUMN public.crm_contacts.apollo_phone_reveal_status IS
  'pending = Apollo phone reveal requested; revealed = phone delivered; NULL = not requested / manual phone.';

CREATE INDEX IF NOT EXISTS idx_crm_contacts_apollo_phone_reveal_status
  ON public.crm_contacts(apollo_phone_reveal_status)
  WHERE apollo_phone_reveal_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.apollo_phone_reveal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(contact_id) ON DELETE CASCADE,
  apollo_person_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_apollo_phone_reveal_requests_contact
  ON public.apollo_phone_reveal_requests(contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_apollo_phone_reveal_requests_person
  ON public.apollo_phone_reveal_requests(apollo_person_id, status);

ALTER TABLE public.apollo_phone_reveal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY apollo_phone_reveal_requests_select_own ON public.apollo_phone_reveal_requests
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
