-- Personal CRM lists: group imported brands for filtering Sequence / Pipeline.

CREATE TABLE IF NOT EXISTS public.crm_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_lists_name_not_blank CHECK (char_length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_lists_owner_name_lower
  ON public.crm_lists (created_by_user_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_crm_lists_owner
  ON public.crm_lists (created_by_user_id);

COMMENT ON TABLE public.crm_lists IS
  'Owner-scoped named brand lists for CRM import grouping and Sequence/Pipeline filters.';

CREATE TABLE IF NOT EXISTS public.crm_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.crm_lists(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  added_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_list_members_list
  ON public.crm_list_members (list_id);

CREATE INDEX IF NOT EXISTS idx_crm_list_members_company
  ON public.crm_list_members (company_id);

COMMENT ON TABLE public.crm_list_members IS
  'Membership of companies in a personal CRM list.';

DROP TRIGGER IF EXISTS crm_lists_updated_at ON public.crm_lists;
CREATE TRIGGER crm_lists_updated_at
BEFORE UPDATE ON public.crm_lists
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS crm_list_members_updated_at ON public.crm_list_members;
CREATE TRIGGER crm_list_members_updated_at
BEFORE UPDATE ON public.crm_list_members
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_list_members ENABLE ROW LEVEL SECURITY;

-- crm_lists
DROP POLICY IF EXISTS crm_lists_select ON public.crm_lists;
DROP POLICY IF EXISTS crm_lists_insert ON public.crm_lists;
DROP POLICY IF EXISTS crm_lists_update ON public.crm_lists;
DROP POLICY IF EXISTS crm_lists_delete ON public.crm_lists;

CREATE POLICY crm_lists_select ON public.crm_lists
  FOR SELECT TO authenticated
  USING (created_by_user_id = auth.uid() OR public.is_admin());

CREATE POLICY crm_lists_insert ON public.crm_lists
  FOR INSERT TO authenticated
  WITH CHECK (created_by_user_id = auth.uid());

CREATE POLICY crm_lists_update ON public.crm_lists
  FOR UPDATE TO authenticated
  USING (created_by_user_id = auth.uid())
  WITH CHECK (created_by_user_id = auth.uid());

CREATE POLICY crm_lists_delete ON public.crm_lists
  FOR DELETE TO authenticated
  USING (created_by_user_id = auth.uid());

-- crm_list_members (via list ownership)
DROP POLICY IF EXISTS crm_list_members_select ON public.crm_list_members;
DROP POLICY IF EXISTS crm_list_members_insert ON public.crm_list_members;
DROP POLICY IF EXISTS crm_list_members_update ON public.crm_list_members;
DROP POLICY IF EXISTS crm_list_members_delete ON public.crm_list_members;

CREATE POLICY crm_list_members_select ON public.crm_list_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_lists l
      WHERE l.id = list_id
        AND (l.created_by_user_id = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY crm_list_members_insert ON public.crm_list_members
  FOR INSERT TO authenticated
  WITH CHECK (
    added_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.crm_lists l
      WHERE l.id = list_id AND l.created_by_user_id = auth.uid()
    )
  );

CREATE POLICY crm_list_members_update ON public.crm_list_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_lists l
      WHERE l.id = list_id AND l.created_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crm_lists l
      WHERE l.id = list_id AND l.created_by_user_id = auth.uid()
    )
  );

CREATE POLICY crm_list_members_delete ON public.crm_list_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_lists l
      WHERE l.id = list_id AND l.created_by_user_id = auth.uid()
    )
  );
