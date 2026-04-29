-- Move "Protein / Supplements" to NON_ENDEMIC across all sports.
-- (Grooming / Skincare split is handled in 20260323160000_split_grooming_skincare_taxonomy.sql.)

-- 1) Move Protein / Supplements from ENDEMIC -> NON_ENDEMIC.
UPDATE public.sponsorship_taxonomies
SET tier = 'NON_ENDEMIC'
WHERE category = 'Protein / Supplements'
  AND tier = 'ENDEMIC';

-- 2) Remove accidental duplicates for Protein / Supplements after tier move,
-- keeping the oldest row per sport/tier/category.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY sport, tier, category
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.sponsorship_taxonomies
  WHERE category = 'Protein / Supplements'
    AND tier = 'NON_ENDEMIC'
)
DELETE FROM public.sponsorship_taxonomies t
USING ranked r
WHERE t.id = r.id
  AND r.rn > 1;
