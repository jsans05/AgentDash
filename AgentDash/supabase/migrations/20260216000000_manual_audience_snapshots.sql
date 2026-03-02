-- =============================================================================
-- Manual Audience Snapshots (CreatorIQ fallback)
-- =============================================================================
-- Admin-only manual entry of audience metrics when CreatorIQ pulling is unavailable.
-- Does not overwrite existing CreatorIQ data; consumed as fallback when no recent CIQ audience.
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

-- gender: { "female": number, "male": number }
-- age: { "u18", "a18_24", "a25_34", "a35_44", "a45_54", "a55_64", "o64" } (each number 0-100)
-- top_* / brands / interests: [ { "name": "...", "pct": number }, ... ]
-- ethnicity: { "caucasian", "hispanic", "asian", "black" } (each number 0-100)

CREATE INDEX IF NOT EXISTS idx_manual_audience_snapshots_athlete_captured
  ON public.manual_audience_snapshots(athlete_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_audience_snapshots_athlete_active
  ON public.manual_audience_snapshots(athlete_id, is_active) WHERE is_active = true;

COMMENT ON TABLE public.manual_audience_snapshots IS 'Admin-entered audience metrics fallback when CreatorIQ is unavailable. One active snapshot per athlete.';

-- RLS: same pattern as creatoriq_snapshots – admin/sales full; agents read own athletes via athlete_agents
ALTER TABLE public.manual_audience_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_audience_snapshots_select_admin_sales" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_select_agent_own" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_insert_admin_sales" ON public.manual_audience_snapshots;
DROP POLICY IF EXISTS "manual_audience_snapshots_update_admin_sales" ON public.manual_audience_snapshots;

CREATE POLICY "manual_audience_snapshots_select_admin_sales" ON public.manual_audience_snapshots
  FOR SELECT USING (public.is_admin() OR public.is_sales());

CREATE POLICY "manual_audience_snapshots_select_agent_own" ON public.manual_audience_snapshots
  FOR SELECT USING (
    public.is_agent_or_above() AND (
      public.is_admin() OR public.is_sales() OR
      athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "manual_audience_snapshots_insert_admin_sales" ON public.manual_audience_snapshots
  FOR INSERT WITH CHECK (public.is_admin() OR public.is_sales());

CREATE POLICY "manual_audience_snapshots_update_admin_sales" ON public.manual_audience_snapshots
  FOR UPDATE USING (public.is_admin() OR public.is_sales());
