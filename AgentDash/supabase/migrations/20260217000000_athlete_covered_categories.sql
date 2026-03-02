-- Athlete-level "covered" taxonomy categories: when ON, Mystery Machine will not prospect in that category.
-- Simplifies AI logic: user explicitly marks categories as covered (e.g. exclusive or not pursuing).
CREATE TABLE IF NOT EXISTS public.athlete_covered_categories (
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  taxonomy_id uuid NOT NULL REFERENCES public.sponsorship_taxonomies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, taxonomy_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_covered_categories_athlete_id ON public.athlete_covered_categories(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_covered_categories_taxonomy_id ON public.athlete_covered_categories(taxonomy_id);

COMMENT ON TABLE public.athlete_covered_categories IS 'Categories marked as covered per athlete; AI prospecting excludes these.';

ALTER TABLE public.athlete_covered_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_covered_categories_select" ON public.athlete_covered_categories;
DROP POLICY IF EXISTS "athlete_covered_categories_insert" ON public.athlete_covered_categories;
DROP POLICY IF EXISTS "athlete_covered_categories_delete" ON public.athlete_covered_categories;

CREATE POLICY "athlete_covered_categories_select" ON public.athlete_covered_categories
  FOR SELECT USING (
    public.is_admin() OR public.is_sales() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );

CREATE POLICY "athlete_covered_categories_insert" ON public.athlete_covered_categories
  FOR INSERT WITH CHECK (
    public.is_admin() OR public.is_sales() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );

CREATE POLICY "athlete_covered_categories_delete" ON public.athlete_covered_categories
  FOR DELETE USING (
    public.is_admin() OR public.is_sales() OR
    athlete_id IN (SELECT athlete_id FROM public.athlete_agents WHERE user_id = auth.uid())
  );
