-- -----------------------------------------------------------------------------
-- CIQ_ENGAGEMENT_RATE_SNAPSHOTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ciq_engagement_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  publisher_id text NOT NULL,
  social_id text,
  network text,
  start_date date,
  end_date date,
  metrics jsonb NOT NULL,
  raw jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ciq_engagement_snapshots_athlete_time
  ON public.ciq_engagement_rate_snapshots (athlete_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ciq_engagement_snapshots_publisher_time
  ON public.ciq_engagement_rate_snapshots (publisher_id, created_at DESC);

COMMENT ON TABLE public.ciq_engagement_rate_snapshots IS
  'CreatorIQ engagement rate snapshots per athlete/account with normalized metrics and raw report.';

-- RLS: mirror creatoriq_snapshots – admin/sales see all; agents see their athletes; any authenticated can insert; admin can delete.
ALTER TABLE public.ciq_engagement_rate_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ciq_engagement_snapshots_select_admin_sales_all" ON public.ciq_engagement_rate_snapshots;
DROP POLICY IF EXISTS "ciq_engagement_snapshots_select_agent_own" ON public.ciq_engagement_rate_snapshots;
DROP POLICY IF EXISTS "ciq_engagement_snapshots_insert_all" ON public.ciq_engagement_rate_snapshots;
DROP POLICY IF EXISTS "ciq_engagement_snapshots_delete_admin" ON public.ciq_engagement_rate_snapshots;

-- Admin and sales: read all snapshots
CREATE POLICY "ciq_engagement_snapshots_select_admin_sales_all"
  ON public.ciq_engagement_rate_snapshots
  FOR SELECT USING (public.is_admin() OR public.is_sales());

-- Agent: read snapshots for their athletes
CREATE POLICY "ciq_engagement_snapshots_select_agent_own"
  ON public.ciq_engagement_rate_snapshots
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

-- All authenticated users can insert snapshots (for refresh endpoints)
CREATE POLICY "ciq_engagement_snapshots_insert_all"
  ON public.ciq_engagement_rate_snapshots
  FOR INSERT TO authenticated WITH CHECK (true);

-- Admin: delete snapshots
CREATE POLICY "ciq_engagement_snapshots_delete_admin"
  ON public.ciq_engagement_rate_snapshots
  FOR DELETE USING (public.is_admin());

