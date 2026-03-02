-- -----------------------------------------------------------------------------
-- CIQ_ACCOUNT_INFO_SNAPSHOTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ciq_account_info_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  publisher_id text NOT NULL,
  network text,
  account_handle text,
  account_url text,
  ciq_account_id text,
  metrics jsonb NOT NULL,
  raw jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ciq_account_info_athlete_time
  ON public.ciq_account_info_snapshots (athlete_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ciq_account_info_publisher_time
  ON public.ciq_account_info_snapshots (publisher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ciq_account_info_network_handle
  ON public.ciq_account_info_snapshots (network, account_handle);

COMMENT ON TABLE public.ciq_account_info_snapshots IS
  'CreatorIQ social accountInfo snapshots per athlete/account with normalized metrics and raw response.';

-- RLS similar to other CIQ tables
ALTER TABLE public.ciq_account_info_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ciq_account_info_select_admin_sales_all" ON public.ciq_account_info_snapshots;
DROP POLICY IF EXISTS "ciq_account_info_select_agent_own" ON public.ciq_account_info_snapshots;
DROP POLICY IF EXISTS "ciq_account_info_insert_all" ON public.ciq_account_info_snapshots;
DROP POLICY IF EXISTS "ciq_account_info_delete_admin" ON public.ciq_account_info_snapshots;

CREATE POLICY "ciq_account_info_select_admin_sales_all"
  ON public.ciq_account_info_snapshots
  FOR SELECT USING (public.is_admin() OR public.is_sales());

CREATE POLICY "ciq_account_info_select_agent_own"
  ON public.ciq_account_info_snapshots
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athletes WHERE current_agent_id = auth.uid())
    )
  );

CREATE POLICY "ciq_account_info_insert_all"
  ON public.ciq_account_info_snapshots
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "ciq_account_info_delete_admin"
  ON public.ciq_account_info_snapshots
  FOR DELETE USING (public.is_admin());

