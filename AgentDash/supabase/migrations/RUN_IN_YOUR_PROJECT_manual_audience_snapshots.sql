-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor (project used by your app)
-- so the Manual Audience (CreatorIQ Fallback) page works.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.manual_audience_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',
  is_active boolean NOT NULL DEFAULT true,

  gender jsonb NOT NULL DEFAULT '{}'::jsonb,
  age jsonb NOT NULL DEFAULT '{}'::jsonb,
  top_countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_cities jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  brands jsonb NOT NULL DEFAULT '[]'::jsonb,
  interests jsonb NOT NULL DEFAULT '[]'::jsonb,
  ethnicity jsonb NOT NULL DEFAULT '{}'::jsonb,

  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_audience_snapshots_athlete_captured
  ON public.manual_audience_snapshots(athlete_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_audience_snapshots_athlete_active
  ON public.manual_audience_snapshots(athlete_id, is_active) WHERE is_active = true;

COMMENT ON TABLE public.manual_audience_snapshots IS 'Admin-entered audience metrics fallback when CreatorIQ is unavailable.';

ALTER TABLE public.manual_audience_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_audience_snapshots_select" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_insert" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_update" ON public.manual_audience_snapshots;
-- Drop AgentDash-named policies if they exist (from 20260216000000 migration)
DROP POLICY IF EXISTS "manual_audience_snapshots_select_admin_sales" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_select_agent_own" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_insert_admin_sales" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_update_admin_sales" ON public.manual_audience_snapshots;

CREATE POLICY "manual_audience_snapshots_select" ON public.manual_audience_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manual_audience_snapshots_insert" ON public.manual_audience_snapshots
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "manual_audience_snapshots_update" ON public.manual_audience_snapshots
  FOR UPDATE TO authenticated USING (true);

-- After running, if the app still says "table not in schema cache", in Supabase Dashboard
-- go to Settings → API and use "Reload schema cache" (or wait a short time).
