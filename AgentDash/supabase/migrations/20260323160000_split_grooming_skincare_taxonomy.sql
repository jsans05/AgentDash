-- Split "Grooming / Skincare" into "Grooming" and "Skincare".
-- Merge "Grooming Products" (from prior migration) into "Grooming" per sport, then remove duplicate rows.

-- 1) Rename legacy combined label to Grooming (preserves row ids / FKs).
UPDATE public.sponsorship_taxonomies
SET category = 'Grooming'
WHERE tier = 'NON_ENDEMIC'
  AND category = 'Grooming / Skincare';

-- 2) Make room for Skincare: shift non-endemic categories that sort after Grooming.
UPDATE public.sponsorship_taxonomies t
SET sort_order = t.sort_order + 1
FROM public.sponsorship_taxonomies g
WHERE g.tier = 'NON_ENDEMIC'
  AND g.category = 'Grooming'
  AND t.sport = g.sport
  AND t.tier = 'NON_ENDEMIC'
  AND t.sort_order > g.sort_order
  AND t.id <> g.id;

-- 3) Insert Skincare immediately after Grooming (one row per sport).
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT
  g.sport,
  'NON_ENDEMIC',
  'Skincare',
  g.sort_order + 1
FROM public.sponsorship_taxonomies g
WHERE g.tier = 'NON_ENDEMIC'
  AND g.category = 'Grooming'
  AND NOT EXISTS (
    SELECT 1
    FROM public.sponsorship_taxonomies x
    WHERE x.sport = g.sport
      AND x.tier = 'NON_ENDEMIC'
      AND x.category = 'Skincare'
  );

-- 4) Merge "Grooming Products" into "Grooming" (repoint FKs, then delete GP rows).

-- athlete_covered_categories: drop GP rows if athlete already has Grooming.
DELETE FROM public.athlete_covered_categories acc
USING public.sponsorship_taxonomies gp, public.sponsorship_taxonomies g
WHERE acc.taxonomy_id = gp.id
  AND gp.tier = 'NON_ENDEMIC'
  AND gp.category = 'Grooming Products'
  AND g.sport = gp.sport
  AND g.tier = 'NON_ENDEMIC'
  AND g.category = 'Grooming'
  AND EXISTS (
    SELECT 1
    FROM public.athlete_covered_categories x
    WHERE x.athlete_id = acc.athlete_id
      AND x.taxonomy_id = g.id
  );

UPDATE public.athlete_covered_categories acc
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies gp
JOIN public.sponsorship_taxonomies g
  ON g.sport = gp.sport AND g.tier = 'NON_ENDEMIC' AND g.category = 'Grooming'
WHERE acc.taxonomy_id = gp.id
  AND gp.tier = 'NON_ENDEMIC'
  AND gp.category = 'Grooming Products';

-- contract_exclusivities: drop GP rows if contract already has Grooming.
DELETE FROM public.contract_exclusivities ce
USING public.sponsorship_taxonomies gp, public.sponsorship_taxonomies g
WHERE ce.taxonomy_id = gp.id
  AND gp.tier = 'NON_ENDEMIC'
  AND gp.category = 'Grooming Products'
  AND g.sport = gp.sport
  AND g.tier = 'NON_ENDEMIC'
  AND g.category = 'Grooming'
  AND EXISTS (
    SELECT 1
    FROM public.contract_exclusivities x
    WHERE x.contract_id = ce.contract_id
      AND x.taxonomy_id = g.id
  );

UPDATE public.contract_exclusivities ce
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies gp
JOIN public.sponsorship_taxonomies g
  ON g.sport = gp.sport AND g.tier = 'NON_ENDEMIC' AND g.category = 'Grooming'
WHERE ce.taxonomy_id = gp.id
  AND gp.tier = 'NON_ENDEMIC'
  AND gp.category = 'Grooming Products';

UPDATE public.crm_contacts c
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies gp
JOIN public.sponsorship_taxonomies g
  ON g.sport = gp.sport AND g.tier = 'NON_ENDEMIC' AND g.category = 'Grooming'
WHERE c.taxonomy_id = gp.id
  AND gp.tier = 'NON_ENDEMIC'
  AND gp.category = 'Grooming Products';

DELETE FROM public.sponsorship_taxonomies
WHERE tier = 'NON_ENDEMIC'
  AND category = 'Grooming Products';
