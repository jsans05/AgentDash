-- Sport-specific sponsorship taxonomies (no cross-sport aggregation).
-- Categories are tiered: ENDEMIC (sport-specific) vs NON_ENDEMIC (standardized across sports).

CREATE TABLE IF NOT EXISTS public.sponsorship_taxonomies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('ENDEMIC', 'NON_ENDEMIC')),
  category text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sport, tier, category)
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_taxonomies_sport ON public.sponsorship_taxonomies(sport);
CREATE INDEX IF NOT EXISTS idx_sponsorship_taxonomies_sport_tier ON public.sponsorship_taxonomies(sport, tier);

COMMENT ON TABLE public.sponsorship_taxonomies IS 'Per-sport category lists for contracts and outreach; ENDEMIC = sport-specific, NON_ENDEMIC = standardized across all sports.';
