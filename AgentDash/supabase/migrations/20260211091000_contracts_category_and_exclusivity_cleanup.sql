-- Add text-based category to contracts for outreach and reporting.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS category text;

-- Backfill category from existing exclusivity_categories if present.
UPDATE public.contracts c
SET category = ec.name
FROM public.exclusivity_categories ec
WHERE c.category IS NULL
  AND c.category_id = ec.category_id;

-- For any remaining rows without a category, set a temporary placeholder.
UPDATE public.contracts
SET category = 'unknown'
WHERE category IS NULL;

-- Make category required going forward.
ALTER TABLE public.contracts
  ALTER COLUMN category SET NOT NULL;

-- Drop is_exclusive; all contracts are treated as exclusive by default.
ALTER TABLE public.contracts
  DROP COLUMN IF EXISTS is_exclusive;

