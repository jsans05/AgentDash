-- =============================================================================
-- Operations role: write access to all athletes/contracts + bulk import
-- (no user management, no clear-all / delete athletes)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_operations()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'operations'
  );
$$ LANGUAGE sql SECURITY DEFINER;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'sales', 'agent', 'accounting', 'operations'));

COMMENT ON TABLE public.profiles IS 'User profiles with RBAC roles: admin (full access), sales (read-only all), agent (own athletes only), accounting (read-only roster + contracts), operations (import + edit all athletes/contracts; no user/admin tools).';

-- -----------------------------------------------------------------------------
-- SELECT: operations sees full roster / contracts / agent links (like sales)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select_all_for_admin_sales" ON public.profiles;
CREATE POLICY "profiles_select_all_for_admin_sales" ON public.profiles
  FOR SELECT USING (
    public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations()
  );

DROP POLICY IF EXISTS "athletes_select_admin_sales_all" ON public.athletes;
CREATE POLICY "athletes_select_admin_sales_all" ON public.athletes
  FOR SELECT USING (
    public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations()
  );

DROP POLICY IF EXISTS "athletes_select_agent_own" ON public.athletes;
CREATE POLICY "athletes_select_agent_own" ON public.athletes
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_select_admin_sales_all" ON public.contracts;
CREATE POLICY "contracts_select_admin_sales_all" ON public.contracts
  FOR SELECT USING (
    public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations()
  );

DROP POLICY IF EXISTS "contracts_select_agent_own" ON public.contracts;
CREATE POLICY "contracts_select_agent_own" ON public.contracts
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "athlete_agents_select_admin_sales" ON public.athlete_agents;
CREATE POLICY "athlete_agents_select_admin_sales" ON public.athlete_agents
  FOR SELECT USING (
    public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations()
  );

DROP POLICY IF EXISTS "athlete_agents_select_agent_own" ON public.athlete_agents;
CREATE POLICY "athlete_agents_select_agent_own" ON public.athlete_agents
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations() OR
      user_id = auth.uid()
    )
  );

DO $policy$
BEGIN
  IF to_regclass('public.athlete_agent_history') IS NOT NULL THEN
    DROP POLICY IF EXISTS "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history;
    CREATE POLICY "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history
      FOR SELECT USING (
        public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations()
      );

    DROP POLICY IF EXISTS "athlete_agent_history_select_agent_own" ON public.athlete_agent_history;
    CREATE POLICY "athlete_agent_history_select_agent_own" ON public.athlete_agent_history
      FOR SELECT USING (
        public.is_agent_or_above() AND (
          public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations() OR
          athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
        )
      );
  END IF;
END
$policy$;

DO $policy$
BEGIN
  IF to_regclass('public.athlete_covered_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS "athlete_covered_categories_select" ON public.athlete_covered_categories;
    CREATE POLICY "athlete_covered_categories_select" ON public.athlete_covered_categories
      FOR SELECT USING (
        public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_operations() OR
        athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
      );

    DROP POLICY IF EXISTS "athlete_covered_categories_insert" ON public.athlete_covered_categories;
    CREATE POLICY "athlete_covered_categories_insert" ON public.athlete_covered_categories
      FOR INSERT WITH CHECK (
        public.is_admin() OR public.is_sales() OR public.is_operations() OR
        athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
      );

    DROP POLICY IF EXISTS "athlete_covered_categories_delete" ON public.athlete_covered_categories;
    CREATE POLICY "athlete_covered_categories_delete" ON public.athlete_covered_categories
      FOR DELETE USING (
        public.is_admin() OR public.is_sales() OR public.is_operations() OR
        athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
      );
  END IF;
END
$policy$;

-- -----------------------------------------------------------------------------
-- WRITE: operations can insert/update athletes (no delete)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "athletes_insert_operations" ON public.athletes;
CREATE POLICY "athletes_insert_operations" ON public.athletes
  FOR INSERT WITH CHECK (public.is_operations());

DROP POLICY IF EXISTS "athletes_update_operations" ON public.athletes;
CREATE POLICY "athletes_update_operations" ON public.athletes
  FOR UPDATE USING (public.is_operations())
  WITH CHECK (public.is_operations());

-- -----------------------------------------------------------------------------
-- WRITE: operations can insert/update any contract (covers terminate + archive)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "contracts_insert_operations" ON public.contracts;
CREATE POLICY "contracts_insert_operations" ON public.contracts
  FOR INSERT WITH CHECK (public.is_operations());

DROP POLICY IF EXISTS "contracts_update_operations" ON public.contracts;
CREATE POLICY "contracts_update_operations" ON public.contracts
  FOR UPDATE USING (public.is_operations())
  WITH CHECK (public.is_operations());

-- -----------------------------------------------------------------------------
-- WRITE: operations can link agents during athlete import (insert only)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "athlete_agents_insert_operations" ON public.athlete_agents;
CREATE POLICY "athlete_agents_insert_operations" ON public.athlete_agents
  FOR INSERT WITH CHECK (public.is_operations());

-- -----------------------------------------------------------------------------
-- Companies: allow operations to create companies during contract flows/import
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "companies_insert_agent_or_above" ON public.companies;
CREATE POLICY "companies_insert_agent_or_above" ON public.companies
  FOR INSERT
  WITH CHECK (public.is_agent_or_above() OR public.is_operations());
