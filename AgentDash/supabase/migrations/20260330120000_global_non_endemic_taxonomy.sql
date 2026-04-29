-- Consolidate NON_ENDEMIC rows into a single global bucket (sport = __NON_ENDEMIC_GLOBAL__).
-- Remap FKs so contract_exclusivities, athlete_covered_categories, and crm_contacts keep valid taxonomy_id.

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active)
SELECT
  '__NON_ENDEMIC_GLOBAL__'::text,
  'NON_ENDEMIC',
  category,
  MIN(sort_order)::int,
  bool_or(is_active)
FROM public.sponsorship_taxonomies
WHERE tier = 'NON_ENDEMIC'
  AND sport IS DISTINCT FROM '__NON_ENDEMIC_GLOBAL__'
GROUP BY category
ON CONFLICT (sport, tier, category) DO NOTHING;

-- contract_exclusivities
UPDATE public.contract_exclusivities ce
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies o
JOIN public.sponsorship_taxonomies g
  ON g.sport = '__NON_ENDEMIC_GLOBAL__'
  AND g.tier = 'NON_ENDEMIC'
  AND g.category = o.category
WHERE ce.taxonomy_id = o.id
  AND o.tier = 'NON_ENDEMIC'
  AND o.sport IS DISTINCT FROM '__NON_ENDEMIC_GLOBAL__';

DELETE FROM public.contract_exclusivities a
USING public.contract_exclusivities b
WHERE a.contract_id = b.contract_id
  AND a.taxonomy_id = b.taxonomy_id
  AND a.ctid > b.ctid;

-- athlete_covered_categories
UPDATE public.athlete_covered_categories acc
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies o
JOIN public.sponsorship_taxonomies g
  ON g.sport = '__NON_ENDEMIC_GLOBAL__'
  AND g.tier = 'NON_ENDEMIC'
  AND g.category = o.category
WHERE acc.taxonomy_id = o.id
  AND o.tier = 'NON_ENDEMIC'
  AND o.sport IS DISTINCT FROM '__NON_ENDEMIC_GLOBAL__';

DELETE FROM public.athlete_covered_categories a
USING public.athlete_covered_categories b
WHERE a.athlete_id = b.athlete_id
  AND a.taxonomy_id = b.taxonomy_id
  AND a.ctid > b.ctid;

-- crm_contacts
UPDATE public.crm_contacts c
SET taxonomy_id = g.id
FROM public.sponsorship_taxonomies o
JOIN public.sponsorship_taxonomies g
  ON g.sport = '__NON_ENDEMIC_GLOBAL__'
  AND g.tier = 'NON_ENDEMIC'
  AND g.category = o.category
WHERE c.taxonomy_id = o.id
  AND o.tier = 'NON_ENDEMIC'
  AND o.sport IS DISTINCT FROM '__NON_ENDEMIC_GLOBAL__';

DELETE FROM public.sponsorship_taxonomies
WHERE tier = 'NON_ENDEMIC'
  AND sport IS DISTINCT FROM '__NON_ENDEMIC_GLOBAL__';

COMMENT ON TABLE public.sponsorship_taxonomies IS 'ENDEMIC rows use real sport names; NON_ENDEMIC rows use sport __NON_ENDEMIC_GLOBAL__ only.';
