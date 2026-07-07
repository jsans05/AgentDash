-- =============================================================================
-- Accounting role: read-only access to full roster + contracts (same reads as sales)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_accounting()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'accounting'
  );
$$ LANGUAGE sql SECURITY DEFINER;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'sales', 'agent', 'accounting'));

COMMENT ON TABLE public.profiles IS 'User profiles with RBAC roles: admin (full access), sales (read-only all), agent (own athletes only), accounting (read-only roster + contracts).';

-- -----------------------------------------------------------------------------
-- Core roster / contracts tables
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select_all_for_admin_sales" ON public.profiles;
CREATE POLICY "profiles_select_all_for_admin_sales" ON public.profiles
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

DROP POLICY IF EXISTS "athletes_select_admin_sales_all" ON public.athletes;
CREATE POLICY "athletes_select_admin_sales_all" ON public.athletes
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

DROP POLICY IF EXISTS "athletes_select_agent_own" ON public.athletes;
CREATE POLICY "athletes_select_agent_own" ON public.athletes
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_select_admin_sales_all" ON public.contracts;
CREATE POLICY "contracts_select_admin_sales_all" ON public.contracts
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

DROP POLICY IF EXISTS "contracts_select_agent_own" ON public.contracts;
CREATE POLICY "contracts_select_agent_own" ON public.contracts
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DO $policy$
BEGIN
  IF to_regclass('public.athlete_agent_history') IS NOT NULL THEN
    DROP POLICY IF EXISTS "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history;
    CREATE POLICY "athlete_agent_history_select_admin_sales" ON public.athlete_agent_history
      FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

    DROP POLICY IF EXISTS "athlete_agent_history_select_agent_own" ON public.athlete_agent_history;
    CREATE POLICY "athlete_agent_history_select_agent_own" ON public.athlete_agent_history
      FOR SELECT USING (
        public.is_agent_or_above() AND (
          public.is_admin() OR public.is_sales() OR public.is_accounting() OR
          athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
        )
      );
  END IF;
END
$policy$;

DROP POLICY IF EXISTS "athlete_agents_select_admin_sales" ON public.athlete_agents;
CREATE POLICY "athlete_agents_select_admin_sales" ON public.athlete_agents
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

DROP POLICY IF EXISTS "athlete_agents_select_agent_own" ON public.athlete_agents;
CREATE POLICY "athlete_agents_select_agent_own" ON public.athlete_agents
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR public.is_accounting() OR user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Audience / athlete detail support tables (optional legacy snapshot tables)
-- -----------------------------------------------------------------------------

DO $policy$
BEGIN
  IF to_regclass('public.ciq_engagement_rate_snapshots') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ciq_engagement_snapshots_select_admin_sales_all" ON public.ciq_engagement_rate_snapshots;
    CREATE POLICY "ciq_engagement_snapshots_select_admin_sales_all"
      ON public.ciq_engagement_rate_snapshots
      FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

    DROP POLICY IF EXISTS "ciq_engagement_snapshots_select_agent_own" ON public.ciq_engagement_rate_snapshots;
    CREATE POLICY "ciq_engagement_snapshots_select_agent_own"
      ON public.ciq_engagement_rate_snapshots
      FOR SELECT USING (
        public.is_agent_or_above() AND (
          public.is_admin() OR public.is_sales() OR public.is_accounting() OR
          athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
        )
      );
  END IF;

  IF to_regclass('public.ciq_account_info_snapshots') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ciq_account_info_select_admin_sales_all" ON public.ciq_account_info_snapshots;
    CREATE POLICY "ciq_account_info_select_admin_sales_all"
      ON public.ciq_account_info_snapshots
      FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

    DROP POLICY IF EXISTS "ciq_account_info_select_agent_own" ON public.ciq_account_info_snapshots;
    CREATE POLICY "ciq_account_info_select_agent_own"
      ON public.ciq_account_info_snapshots
      FOR SELECT USING (
        public.is_agent_or_above() AND (
          public.is_admin() OR public.is_sales() OR public.is_accounting() OR
          athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
        )
      );
  END IF;

  IF to_regclass('public.manual_audience_snapshots') IS NOT NULL THEN
    DROP POLICY IF EXISTS "manual_audience_snapshots_select_admin_sales" ON public.manual_audience_snapshots;
    CREATE POLICY "manual_audience_snapshots_select_admin_sales" ON public.manual_audience_snapshots
      FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting());

    DROP POLICY IF EXISTS "manual_audience_snapshots_select_agent_own" ON public.manual_audience_snapshots;
    CREATE POLICY "manual_audience_snapshots_select_agent_own" ON public.manual_audience_snapshots
      FOR SELECT USING (
        public.is_agent_or_above() AND (
          public.is_admin() OR public.is_sales() OR public.is_accounting() OR
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
        public.is_admin() OR public.is_sales() OR public.is_accounting() OR
        athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
      );
  END IF;
END
$policy$;

-- -----------------------------------------------------------------------------
-- CRM SELECT policies (read parity with sales; app layer blocks accounting pages)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS crm_contacts_select ON public.crm_contacts;
CREATE POLICY crm_contacts_select ON public.crm_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR created_by_user_id = auth.uid()
    OR (
      consulting_profile_id IS NOT NULL
      AND public.is_consulting_profile_member(consulting_profile_id)
    )
  );

DROP POLICY IF EXISTS crm_contact_athletes_select ON public.crm_contact_athletes;
CREATE POLICY crm_contact_athletes_select ON public.crm_contact_athletes
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_contact_athletes.contact_id
        AND c.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crm_outreach_logs_select ON public.crm_outreach_logs;
CREATE POLICY crm_outreach_logs_select ON public.crm_outreach_logs
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_outreach_logs.contact_id
        AND c.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crm_companies_pipeline_select ON public.crm_companies_pipeline;
CREATE POLICY crm_companies_pipeline_select ON public.crm_companies_pipeline
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR created_by_user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- AI chat / memory SELECT policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS ai_projects_select ON public.ai_projects;
CREATE POLICY ai_projects_select ON public.ai_projects
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_conversations_select ON public.ai_conversations;
CREATE POLICY ai_conversations_select ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_messages_select ON public.ai_messages;
CREATE POLICY ai_messages_select ON public.ai_messages
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_user_memory_select ON public.ai_user_memory;
CREATE POLICY ai_user_memory_select ON public.ai_user_memory
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_email_tone_samples_select ON public.ai_email_tone_samples;
CREATE POLICY ai_email_tone_samples_select ON public.ai_email_tone_samples
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
  );

-- -----------------------------------------------------------------------------
-- Market intel SELECT policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers;
CREATE POLICY "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors;
CREATE POLICY "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_venues_admin_sales_read" ON public.market_intel_venues;
CREATE POLICY "market_intel_venues_admin_sales_read" ON public.market_intel_venues
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors;
CREATE POLICY "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs;
CREATE POLICY "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_brand_enrichment_admin_sales_read" ON public.market_intel_brand_enrichment;
CREATE POLICY "market_intel_brand_enrichment_admin_sales_read"
  ON public.market_intel_brand_enrichment
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_accounting() OR public.is_consulting_user());

-- -----------------------------------------------------------------------------
-- Consulting profile SELECT policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS consulting_profiles_select ON public.consulting_profiles;
CREATE POLICY consulting_profiles_select ON public.consulting_profiles
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR public.is_consulting_profile_member(id)
  );

DROP POLICY IF EXISTS consulting_profile_members_select ON public.consulting_profile_members;
CREATE POLICY consulting_profile_members_select ON public.consulting_profile_members
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR public.is_consulting_profile_member(profile_id)
  );

DROP POLICY IF EXISTS consulting_target_list_select ON public.consulting_target_list;
CREATE POLICY consulting_target_list_select ON public.consulting_target_list
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR public.is_consulting_profile_member(consulting_profile_id)
  );

DROP POLICY IF EXISTS consulting_profile_seeds_select ON public.consulting_profile_seeds;
CREATE POLICY consulting_profile_seeds_select ON public.consulting_profile_seeds
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR public.is_accounting()
    OR public.is_consulting_profile_member(profile_id)
  );
