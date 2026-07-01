-- =============================================================================
-- Consulting profiles, shared target lists, and seed reference clients
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.consulting_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.consulting_profiles IS
  'Shared consulting practice workspace with one target list and optional seed clients.';

CREATE TABLE IF NOT EXISTS public.consulting_profile_members (
  profile_id uuid NOT NULL REFERENCES public.consulting_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_consulting_profile_members_user
  ON public.consulting_profile_members(user_id);

COMMENT ON TABLE public.consulting_profile_members IS
  'Users assigned to a consulting profile (shared access to target list).';

CREATE TABLE IF NOT EXISTS public.consulting_target_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consulting_profile_id uuid NOT NULL REFERENCES public.consulting_profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  industry_category text,
  match_score numeric,
  company_description text,
  personal_notes text,
  added_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consulting_profile_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_consulting_target_list_profile
  ON public.consulting_target_list(consulting_profile_id);

COMMENT ON TABLE public.consulting_target_list IS
  'Shared prospect list for a consulting profile, grouped by industry_category.';

CREATE TABLE IF NOT EXISTS public.consulting_profile_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.consulting_profiles(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_consulting_profile_seeds_profile
  ON public.consulting_profile_seeds(profile_id);

COMMENT ON TABLE public.consulting_profile_seeds IS
  'Reference client brands used as seeds for lookalike prospecting.';

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS consulting_profile_id uuid REFERENCES public.consulting_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_consulting_profile
  ON public.crm_contacts(consulting_profile_id)
  WHERE consulting_profile_id IS NOT NULL;

COMMENT ON COLUMN public.crm_contacts.consulting_profile_id IS
  'When set, contact is shared across all members of this consulting profile.';

-- updated_at triggers
DROP TRIGGER IF EXISTS consulting_profiles_updated_at ON public.consulting_profiles;
CREATE TRIGGER consulting_profiles_updated_at
BEFORE UPDATE ON public.consulting_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS consulting_target_list_updated_at ON public.consulting_target_list;
CREATE TRIGGER consulting_target_list_updated_at
BEFORE UPDATE ON public.consulting_target_list
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS helpers
CREATE OR REPLACE FUNCTION public.is_consulting_profile_member(profile_uuid uuid)
RETURNS boolean AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.consulting_profile_members m
      WHERE m.profile_id = profile_uuid AND m.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS
ALTER TABLE public.consulting_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consulting_profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consulting_target_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consulting_profile_seeds ENABLE ROW LEVEL SECURITY;

-- consulting_profiles
DROP POLICY IF EXISTS consulting_profiles_select ON public.consulting_profiles;
DROP POLICY IF EXISTS consulting_profiles_insert ON public.consulting_profiles;
DROP POLICY IF EXISTS consulting_profiles_update ON public.consulting_profiles;
DROP POLICY IF EXISTS consulting_profiles_delete ON public.consulting_profiles;

CREATE POLICY consulting_profiles_select ON public.consulting_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(id));

CREATE POLICY consulting_profiles_insert ON public.consulting_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY consulting_profiles_update ON public.consulting_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY consulting_profiles_delete ON public.consulting_profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- consulting_profile_members
DROP POLICY IF EXISTS consulting_profile_members_select ON public.consulting_profile_members;
DROP POLICY IF EXISTS consulting_profile_members_insert ON public.consulting_profile_members;
DROP POLICY IF EXISTS consulting_profile_members_delete ON public.consulting_profile_members;

CREATE POLICY consulting_profile_members_select ON public.consulting_profile_members
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(profile_id));

CREATE POLICY consulting_profile_members_insert ON public.consulting_profile_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY consulting_profile_members_delete ON public.consulting_profile_members
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- consulting_target_list
DROP POLICY IF EXISTS consulting_target_list_select ON public.consulting_target_list;
DROP POLICY IF EXISTS consulting_target_list_insert ON public.consulting_target_list;
DROP POLICY IF EXISTS consulting_target_list_update ON public.consulting_target_list;
DROP POLICY IF EXISTS consulting_target_list_delete ON public.consulting_target_list;

CREATE POLICY consulting_target_list_select ON public.consulting_target_list
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(consulting_profile_id));

CREATE POLICY consulting_target_list_insert ON public.consulting_target_list
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_consulting_profile_member(consulting_profile_id)
      AND added_by_user_id = auth.uid()
    )
  );

CREATE POLICY consulting_target_list_update ON public.consulting_target_list
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(consulting_profile_id))
  WITH CHECK (public.is_admin() OR public.is_consulting_profile_member(consulting_profile_id));

CREATE POLICY consulting_target_list_delete ON public.consulting_target_list
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(consulting_profile_id));

-- consulting_profile_seeds
DROP POLICY IF EXISTS consulting_profile_seeds_select ON public.consulting_profile_seeds;
DROP POLICY IF EXISTS consulting_profile_seeds_insert ON public.consulting_profile_seeds;
DROP POLICY IF EXISTS consulting_profile_seeds_delete ON public.consulting_profile_seeds;

CREATE POLICY consulting_profile_seeds_select ON public.consulting_profile_seeds
  FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(profile_id));

CREATE POLICY consulting_profile_seeds_insert ON public.consulting_profile_seeds
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_consulting_profile_member(profile_id));

CREATE POLICY consulting_profile_seeds_delete ON public.consulting_profile_seeds
  FOR DELETE TO authenticated
  USING (public.is_admin() OR public.is_consulting_profile_member(profile_id));

-- Extend crm_contacts for shared consulting contacts
DROP POLICY IF EXISTS crm_contacts_select ON public.crm_contacts;
CREATE POLICY crm_contacts_select ON public.crm_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR created_by_user_id = auth.uid()
    OR (
      consulting_profile_id IS NOT NULL
      AND public.is_consulting_profile_member(consulting_profile_id)
    )
  );

DROP POLICY IF EXISTS crm_contacts_insert ON public.crm_contacts;
CREATE POLICY crm_contacts_insert ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_sales()
      AND created_by_user_id = auth.uid()
      AND (
        consulting_profile_id IS NULL
        OR public.is_consulting_profile_member(consulting_profile_id)
      )
    )
    OR (
      public.is_agent()
      AND created_by_user_id = auth.uid()
      AND (
        consulting_profile_id IS NULL
        OR public.is_consulting_profile_member(consulting_profile_id)
      )
    )
  );

DROP POLICY IF EXISTS crm_contacts_update ON public.crm_contacts;
CREATE POLICY crm_contacts_update ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
    OR (
      consulting_profile_id IS NOT NULL
      AND public.is_consulting_profile_member(consulting_profile_id)
    )
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
    OR (
      consulting_profile_id IS NOT NULL
      AND public.is_consulting_profile_member(consulting_profile_id)
    )
  );

DROP POLICY IF EXISTS crm_contacts_delete ON public.crm_contacts;
CREATE POLICY crm_contacts_delete ON public.crm_contacts
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
    OR (
      consulting_profile_id IS NOT NULL
      AND public.is_consulting_profile_member(consulting_profile_id)
    )
  );
