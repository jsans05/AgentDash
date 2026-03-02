-- =============================================================================
-- Multiple agents per athlete: junction table + RLS
-- =============================================================================
-- athlete_agents links athletes to agents (many-to-many). athletes.current_agent_id
-- remains as "primary" agent for display; RLS uses athlete_agents for access.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ATHLETE_AGENTS junction table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_agents (
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (athlete_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_agents_user ON public.athlete_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_athlete_agents_athlete ON public.athlete_agents(athlete_id);
-- Only one primary agent per athlete
CREATE UNIQUE INDEX IF NOT EXISTS idx_athlete_agents_primary
  ON public.athlete_agents(athlete_id) WHERE is_primary = true;

COMMENT ON TABLE public.athlete_agents IS 'Many-to-many: athletes can have multiple agents. is_primary drives athletes.current_agent_id for display.';

-- -----------------------------------------------------------------------------
-- 2. Backfill from current_agent_id
-- -----------------------------------------------------------------------------
INSERT INTO public.athlete_agents (athlete_id, user_id, is_primary)
SELECT athlete_id, current_agent_id, true
FROM public.athletes
WHERE current_agent_id IS NOT NULL
ON CONFLICT (athlete_id, user_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Helper: athlete is represented by current user (via athlete_agents)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.athlete_belongs_to_agent(athlete_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.athlete_agents
    WHERE athlete_id = athlete_uuid AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 4. RLS on athlete_agents
-- -----------------------------------------------------------------------------
ALTER TABLE public.athlete_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_agents_select_admin_sales" ON public.athlete_agents;
DROP POLICY IF EXISTS "athlete_agents_select_agent_own" ON public.athlete_agents;
DROP POLICY IF EXISTS "athlete_agents_insert_admin" ON public.athlete_agents;
DROP POLICY IF EXISTS "athlete_agents_update_admin" ON public.athlete_agents;
DROP POLICY IF EXISTS "athlete_agents_delete_admin" ON public.athlete_agents;

CREATE POLICY "athlete_agents_select_admin_sales" ON public.athlete_agents
  FOR SELECT USING (public.is_admin() OR public.is_sales());

CREATE POLICY "athlete_agents_select_agent_own" ON public.athlete_agents
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR user_id = auth.uid()
    )
  );

CREATE POLICY "athlete_agents_insert_admin" ON public.athlete_agents
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "athlete_agents_update_admin" ON public.athlete_agents
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "athlete_agents_delete_admin" ON public.athlete_agents
  FOR DELETE USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 5. Keep athletes.current_agent_id in sync with primary in athlete_agents
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_athlete_primary_agent()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- After delete: set primary to remaining primary, or any remaining agent, or NULL
    UPDATE public.athletes
    SET current_agent_id = (
      SELECT aa.user_id FROM public.athlete_agents aa
      WHERE aa.athlete_id = OLD.athlete_id
      ORDER BY aa.is_primary DESC NULLS LAST
      LIMIT 1
    )
    WHERE athlete_id = OLD.athlete_id;
    RETURN OLD;
  END IF;

  UPDATE public.athletes
  SET current_agent_id = (
    SELECT aa.user_id FROM public.athlete_agents aa
    WHERE aa.athlete_id = COALESCE(NEW.athlete_id, OLD.athlete_id) AND aa.is_primary = true
    LIMIT 1
  )
  WHERE athlete_id = COALESCE(NEW.athlete_id, OLD.athlete_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_athlete_primary_agent_ins_upd ON public.athlete_agents;
DROP TRIGGER IF EXISTS sync_athlete_primary_agent_del ON public.athlete_agents;

CREATE TRIGGER sync_athlete_primary_agent_ins_upd
  AFTER INSERT OR UPDATE OF is_primary ON public.athlete_agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_athlete_primary_agent();

CREATE TRIGGER sync_athlete_primary_agent_del
  AFTER DELETE ON public.athlete_agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_athlete_primary_agent();

-- -----------------------------------------------------------------------------
-- 6. Update RLS: athletes/contracts/snapshots/history use athlete_agents
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "athletes_select_agent_own" ON public.athletes;
CREATE POLICY "athletes_select_agent_own" ON public.athletes
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "athletes_update_agent_own" ON public.athletes;
CREATE POLICY "athletes_update_agent_own" ON public.athletes
  FOR UPDATE USING (
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  )
  WITH CHECK (
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "athlete_agent_history_select_agent_own" ON public.athlete_agent_history;
CREATE POLICY "athlete_agent_history_select_agent_own" ON public.athlete_agent_history
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_select_agent_own" ON public.contracts;
CREATE POLICY "contracts_select_agent_own" ON public.contracts
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_insert_agent" ON public.contracts;
CREATE POLICY "contracts_insert_agent" ON public.contracts
  FOR INSERT WITH CHECK (
    public.is_agent_or_above() AND (
      public.is_admin() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "contracts_update_agent_own" ON public.contracts;
CREATE POLICY "contracts_update_agent_own" ON public.contracts
  FOR UPDATE USING (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "contracts_delete_agent_own" ON public.contracts;
CREATE POLICY "contracts_delete_agent_own" ON public.contracts
  FOR DELETE USING (
    public.is_admin() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "creatoriq_snapshots_select_agent_own" ON public.creatoriq_snapshots;
CREATE POLICY "creatoriq_snapshots_select_agent_own" ON public.creatoriq_snapshots
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );
