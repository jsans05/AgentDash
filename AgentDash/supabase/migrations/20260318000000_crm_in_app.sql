-- =============================================================================
-- In-App CRM (contacts + outreach) for WassIntel
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers: role checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_agent()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'agent'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 1) CRM CONTACTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,

  first_name text NOT NULL,
  last_name text NOT NULL,

  -- Person role/title at the company (e.g., "VP Partnerships")
  role text,

  email text,
  linkedin_url text,
  zoominfo_url text,

  -- Taxonomy-based lane (canonical dropdown item) + denormalized display category
  taxonomy_id uuid REFERENCES public.sponsorship_taxonomies(id) ON DELETE SET NULL,
  category text,

  -- Notes about the product / category fit (as requested)
  product_description text,

  notes text,

  last_outreach_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_company ON public.crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_owner ON public.crm_contacts(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_name ON public.crm_contacts(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_taxonomy ON public.crm_contacts(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_last_outreach ON public.crm_contacts(last_outreach_at);

COMMENT ON TABLE public.crm_contacts IS 'CRM contact records (owned per agent) used for outreach.';

-- -----------------------------------------------------------------------------
-- 2) CRM CONTACT <-> ATHLETES LINKING
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_contact_athletes (
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(contact_id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (contact_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_athletes_contact ON public.crm_contact_athletes(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_contact_athletes_athlete ON public.crm_contact_athletes(athlete_id);

COMMENT ON TABLE public.crm_contact_athletes IS 'Many-to-many linking CRM contacts to athletes.';

-- -----------------------------------------------------------------------------
-- 3) CRM OUTREACH LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_outreach_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.crm_contacts(contact_id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(athlete_id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE SET NULL,

  outreach_channel text NOT NULL DEFAULT 'other',
  outreach_at timestamptz NOT NULL DEFAULT now(),
  outreach_notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_outreach_logs_contact ON public.crm_outreach_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_logs_athlete ON public.crm_outreach_logs(athlete_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_logs_user ON public.crm_outreach_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_logs_outreach_at ON public.crm_outreach_logs(outreach_at DESC);

COMMENT ON TABLE public.crm_outreach_logs IS 'Audit log of CRM outreach attempts and notes.';

-- -----------------------------------------------------------------------------
-- 4) Triggers: updated_at + last_outreach_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS crm_contacts_updated_at ON public.crm_contacts;
CREATE TRIGGER crm_contacts_updated_at
BEFORE UPDATE ON public.crm_contacts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.set_crm_contacts_last_outreach_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.crm_contacts c
  SET last_outreach_at = (
    SELECT MAX(l.outreach_at)
    FROM public.crm_outreach_logs l
    WHERE l.contact_id = NEW.contact_id
  )
  WHERE c.contact_id = NEW.contact_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_outreach_logs_after_insert ON public.crm_outreach_logs;
CREATE TRIGGER crm_outreach_logs_after_insert
AFTER INSERT ON public.crm_outreach_logs
FOR EACH ROW
EXECUTE FUNCTION public.set_crm_contacts_last_outreach_at();

-- -----------------------------------------------------------------------------
-- 5) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outreach_logs ENABLE ROW LEVEL SECURITY;

-- crm_contacts policies
DROP POLICY IF EXISTS crm_contacts_select ON public.crm_contacts;
DROP POLICY IF EXISTS crm_contacts_insert ON public.crm_contacts;
DROP POLICY IF EXISTS crm_contacts_update ON public.crm_contacts;
DROP POLICY IF EXISTS crm_contacts_delete ON public.crm_contacts;

CREATE POLICY crm_contacts_select ON public.crm_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR created_by_user_id = auth.uid()
  );

-- Only admins can create for other users. Agents can create for themselves.
CREATE POLICY crm_contacts_insert ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );

CREATE POLICY crm_contacts_update ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );

CREATE POLICY crm_contacts_delete ON public.crm_contacts
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );

-- crm_contact_athletes policies
DROP POLICY IF EXISTS crm_contact_athletes_select ON public.crm_contact_athletes;
DROP POLICY IF EXISTS crm_contact_athletes_insert ON public.crm_contact_athletes;
DROP POLICY IF EXISTS crm_contact_athletes_delete ON public.crm_contact_athletes;

CREATE POLICY crm_contact_athletes_select ON public.crm_contact_athletes
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_contact_athletes.contact_id
        AND c.created_by_user_id = auth.uid()
    )
  );

CREATE POLICY crm_contact_athletes_insert ON public.crm_contact_athletes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_contact_athletes.contact_id
        AND public.is_agent()
        AND c.created_by_user_id = auth.uid()
    )
  );

CREATE POLICY crm_contact_athletes_delete ON public.crm_contact_athletes
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_contact_athletes.contact_id
        AND public.is_agent()
        AND c.created_by_user_id = auth.uid()
    )
  );

-- crm_outreach_logs policies
DROP POLICY IF EXISTS crm_outreach_logs_select ON public.crm_outreach_logs;
DROP POLICY IF EXISTS crm_outreach_logs_insert ON public.crm_outreach_logs;

CREATE POLICY crm_outreach_logs_select ON public.crm_outreach_logs
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_outreach_logs.contact_id
        AND c.created_by_user_id = auth.uid()
    )
  );

CREATE POLICY crm_outreach_logs_insert ON public.crm_outreach_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_agent()
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.crm_contacts c
        WHERE c.contact_id = crm_outreach_logs.contact_id
          AND c.created_by_user_id = auth.uid()
      )
    )
  );

