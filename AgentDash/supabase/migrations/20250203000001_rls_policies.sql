-- =============================================================================
-- AgentDash RLS Policies
-- =============================================================================
-- Enforces RBAC: admin (full), sales (read-only all), agent (own athletes only)
-- =============================================================================

-- Helper function: check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function: check if user is sales
CREATE OR REPLACE FUNCTION public.is_sales()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'sales'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function: check if user is agent (or admin/sales)
CREATE OR REPLACE FUNCTION public.is_agent_or_above()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role IN ('admin', 'sales', 'agent')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function: check if athlete belongs to current agent
CREATE OR REPLACE FUNCTION public.athlete_belongs_to_agent(athlete_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.athletes
    WHERE athlete_id = athlete_uuid
      AND current_agent_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_agent_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exclusivity_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creatoriq_snapshots ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all_for_admin_sales" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

-- Users can read their own profile
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Admin and sales can read all profiles
CREATE POLICY "profiles_select_all_for_admin_sales" ON public.profiles
  FOR SELECT USING (public.is_admin() OR public.is_sales());

-- Users can update their own profile (role changes require admin)
-- Note: Role changes are enforced at application level; RLS allows updates to own profile
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can insert their own profile (on signup)
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- ATHLETES
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "athletes_select_admin_sales_all" ON public.athletes;
DROP POLICY IF EXISTS "athletes_select_agent_own" ON public.athletes;
DROP POLICY IF EXISTS "athletes_insert_admin" ON public.athletes;
DROP POLICY IF EXISTS "athletes_update_admin" ON public.athletes;
DROP POLICY IF EXISTS "athletes_update_agent_own" ON public.athletes;
DROP POLICY IF EXISTS "athletes_delete_admin" ON public.athletes;

-- Admin and sales: read all athletes
CREATE POLICY "athletes_select_admin_sales_all" ON public.athletes
  FOR SELECT USING (public.is_admin() OR public.is_sales());

-- Agent: read only their athletes
CREATE POLICY "athletes_select_agent_own" ON public.athletes
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR current_agent_id = auth.uid()
    )
  );

-- Admin: full CRUD
CREATE POLICY "athletes_insert_admin" ON public.athletes
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "athletes_update_admin" ON public.athletes
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "athletes_delete_admin" ON public.athletes
  FOR DELETE USING (public.is_admin());

-- Agent: update their own athletes (including accolades)
CREATE POLICY "athletes_update_agent_own" ON public.athletes
  FOR UPDATE USING (current_agent_id = auth.uid())
  WITH CHECK (current_agent_id = auth.uid());

-- -----------------------------------------------------------------------------
-- ATHLETE_AGENT_HISTORY
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history;
DROP POLICY IF EXISTS "athlete_agent_history_select_agent_own" ON public.athlete_agent_history;
DROP POLICY IF EXISTS "athlete_agent_history_insert_admin" ON public.athlete_agent_history;

CREATE POLICY "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history
  FOR SELECT USING (public.is_admin() OR public.is_sales());

CREATE POLICY "athlete_agent_history_select_agent_own" ON public.athlete_agent_history
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

-- Admin-only inserts (via application logic)
CREATE POLICY "athlete_agent_history_insert_admin" ON public.athlete_agent_history
  FOR INSERT WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- COMPANIES
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "companies_select_all" ON public.companies;
DROP POLICY IF EXISTS "companies_insert_admin" ON public.companies;
DROP POLICY IF EXISTS "companies_update_admin" ON public.companies;
DROP POLICY IF EXISTS "companies_delete_admin" ON public.companies;

-- All authenticated users can read companies
CREATE POLICY "companies_select_all" ON public.companies
  FOR SELECT TO authenticated USING (true);

-- Admin: full CRUD
CREATE POLICY "companies_insert_admin" ON public.companies
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "companies_update_admin" ON public.companies
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "companies_delete_admin" ON public.companies
  FOR DELETE USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- COMPANY_CONTACTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "company_contacts_select_all" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts_insert_agent" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts_update_agent_own" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts_delete_agent_own" ON public.company_contacts;
DROP POLICY IF EXISTS "company_contacts_crud_admin" ON public.company_contacts;

-- All authenticated users can read contacts
CREATE POLICY "company_contacts_select_all" ON public.company_contacts
  FOR SELECT TO authenticated USING (true);

-- Agent: CRUD their own contacts
CREATE POLICY "company_contacts_insert_agent" ON public.company_contacts
  FOR INSERT WITH CHECK (
    public.is_agent_or_above() AND (
      public.is_admin() OR agent_id = auth.uid()
    )
  );

CREATE POLICY "company_contacts_update_agent_own" ON public.company_contacts
  FOR UPDATE USING (
    public.is_admin() OR agent_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin() OR agent_id = auth.uid()
  );

CREATE POLICY "company_contacts_delete_agent_own" ON public.company_contacts
  FOR DELETE USING (
    public.is_admin() OR agent_id = auth.uid()
  );

-- Admin: full CRUD
CREATE POLICY "company_contacts_crud_admin" ON public.company_contacts
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- EXCLUSIVITY_CATEGORIES
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "exclusivity_categories_select_all" ON public.exclusivity_categories;
DROP POLICY IF EXISTS "exclusivity_categories_crud_admin" ON public.exclusivity_categories;

-- All authenticated users can read categories
CREATE POLICY "exclusivity_categories_select_all" ON public.exclusivity_categories
  FOR SELECT TO authenticated USING (true);

-- Admin: full CRUD
CREATE POLICY "exclusivity_categories_crud_admin" ON public.exclusivity_categories
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- CONTRACTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "contracts_select_admin_sales_all" ON public.contracts;
DROP POLICY IF EXISTS "contracts_select_agent_own" ON public.contracts;
DROP POLICY IF EXISTS "contracts_insert_agent" ON public.contracts;
DROP POLICY IF EXISTS "contracts_update_agent_own" ON public.contracts;
DROP POLICY IF EXISTS "contracts_delete_agent_own" ON public.contracts;
DROP POLICY IF EXISTS "contracts_crud_admin" ON public.contracts;

-- Admin and sales: read all contracts
CREATE POLICY "contracts_select_admin_sales_all" ON public.contracts
  FOR SELECT USING (public.is_admin() OR public.is_sales());

-- Agent: read contracts for their athletes
CREATE POLICY "contracts_select_agent_own" ON public.contracts
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

-- Agent: CRUD contracts for their athletes
CREATE POLICY "contracts_insert_agent" ON public.contracts
  FOR INSERT WITH CHECK (
    public.is_agent_or_above() AND (
      public.is_admin() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

CREATE POLICY "contracts_update_agent_own" ON public.contracts
  FOR UPDATE USING (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
  );

CREATE POLICY "contracts_delete_agent_own" ON public.contracts
  FOR DELETE USING (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
  );

-- Admin: full CRUD
CREATE POLICY "contracts_crud_admin" ON public.contracts
  FOR ALL USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- CREATORIQ_SNAPSHOTS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "creatoriq_snapshots_select_admin_sales_all" ON public.creatoriq_snapshots;
DROP POLICY IF EXISTS "creatoriq_snapshots_select_agent_own" ON public.creatoriq_snapshots;
DROP POLICY IF EXISTS "creatoriq_snapshots_insert_all" ON public.creatoriq_snapshots;
DROP POLICY IF EXISTS "creatoriq_snapshots_delete_admin" ON public.creatoriq_snapshots;

-- Admin and sales: read all snapshots
CREATE POLICY "creatoriq_snapshots_select_admin_sales_all" ON public.creatoriq_snapshots
  FOR SELECT USING (public.is_admin() OR public.is_sales());

-- Agent: read snapshots for their athletes
CREATE POLICY "creatoriq_snapshots_select_agent_own" ON public.creatoriq_snapshots
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

-- All authenticated users can insert snapshots (for refresh endpoints)
CREATE POLICY "creatoriq_snapshots_insert_all" ON public.creatoriq_snapshots
  FOR INSERT TO authenticated WITH CHECK (true);

-- Admin: delete snapshots
CREATE POLICY "creatoriq_snapshots_delete_admin" ON public.creatoriq_snapshots
  FOR DELETE USING (public.is_admin());
