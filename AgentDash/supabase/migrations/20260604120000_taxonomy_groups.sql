-- Pseudo-folder groups for sponsorship taxonomy (parent checkbox + child categories).

ALTER TABLE public.sponsorship_taxonomies
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.sponsorship_taxonomies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sponsorship_taxonomies_parent
  ON public.sponsorship_taxonomies(parent_id)
  WHERE parent_id IS NOT NULL;

COMMENT ON COLUMN public.sponsorship_taxonomies.parent_id IS 'Optional parent group row (is_group=true). Children are selectable categories.';
COMMENT ON COLUMN public.sponsorship_taxonomies.is_group IS 'When true, row is a UI folder only (not stored on contracts/covered categories).';
