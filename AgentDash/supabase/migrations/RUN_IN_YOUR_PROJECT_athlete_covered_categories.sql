-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor (project used by your app)
-- so "Prospecting categories" works and the schema cache finds the table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.athlete_covered_categories (
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  taxonomy_id uuid NOT NULL REFERENCES public.sponsorship_taxonomies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, taxonomy_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_covered_categories_athlete_id ON public.athlete_covered_categories(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_covered_categories_taxonomy_id ON public.athlete_covered_categories(taxonomy_id);

COMMENT ON TABLE public.athlete_covered_categories IS 'Categories marked as covered per athlete; Mystery Machine excludes these from prospecting.';

ALTER TABLE public.athlete_covered_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_covered_categories_select" ON public.athlete_covered_categories;
DROP POLICY IF EXISTS "athlete_covered_categories_insert" ON public.athlete_covered_categories;
DROP POLICY IF EXISTS "athlete_covered_categories_delete" ON public.athlete_covered_categories;

-- Allow authenticated users; the API already enforces agent/admin/sales access.
CREATE POLICY "athlete_covered_categories_select" ON public.athlete_covered_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "athlete_covered_categories_insert" ON public.athlete_covered_categories
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "athlete_covered_categories_delete" ON public.athlete_covered_categories
  FOR DELETE TO authenticated USING (true);

-- After running: Supabase may take a moment to refresh the schema cache.
-- If the app still shows "table not in schema cache", go to Settings → API and
-- use "Reload schema cache" (or wait a minute and refresh the athlete page).
