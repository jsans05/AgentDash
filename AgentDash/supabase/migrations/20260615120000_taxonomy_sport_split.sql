-- Taxonomy sport split: new motorsports parents, Lifestyle rename, six new sports.
-- Removes Racing / Motorsports after cloning endemic rows and remapping FKs.

-- 1) Rename Lifestyle parent (preserves row ids)
UPDATE public.sponsorship_taxonomies
SET sport = 'Lifestyle'
WHERE sport = 'Lifestyle / Broadcast / Chef / Personality';

-- 2) Clone Racing / Motorsports ENDEMIC to four-wheel parents
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active, is_group)
SELECT 'Four Wheel Offroad', tier, category, sort_order, is_active, false
FROM public.sponsorship_taxonomies
WHERE sport = 'Racing / Motorsports' AND tier = 'ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active, is_group)
SELECT 'Drag', tier, category, sort_order, is_active, false
FROM public.sponsorship_taxonomies
WHERE sport = 'Racing / Motorsports' AND tier = 'ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active, is_group)
SELECT 'Indy / F1', tier, category, sort_order, is_active, false
FROM public.sponsorship_taxonomies
WHERE sport = 'Racing / Motorsports' AND tier = 'ENDEMIC'
ON CONFLICT (sport, tier, category) DO NOTHING;

-- 3) Clone Supercross / Motocross (Moto) ENDEMIC to Moto GP (preserves group hierarchy)
CREATE TEMP TABLE taxonomy_moto_gp_id_map (
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  src_sport text := 'Supercross / Motocross (Moto)';
  tgt_sport text := 'Moto GP';
  r record;
  new_id uuid;
BEGIN
  FOR r IN
    SELECT *
    FROM public.sponsorship_taxonomies
    WHERE sport = src_sport AND tier = 'ENDEMIC' AND parent_id IS NULL
    ORDER BY is_group DESC, sort_order, category
  LOOP
    INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active, is_group, parent_id)
    VALUES (tgt_sport, r.tier, r.category, r.sort_order, r.is_active, r.is_group, NULL)
    ON CONFLICT (sport, tier, category) DO UPDATE
      SET sort_order = EXCLUDED.sort_order, is_group = EXCLUDED.is_group
    RETURNING id INTO new_id;

    IF new_id IS NULL THEN
      SELECT id INTO new_id
      FROM public.sponsorship_taxonomies
      WHERE sport = tgt_sport AND tier = r.tier AND category = r.category;
    END IF;

    INSERT INTO taxonomy_moto_gp_id_map (old_id, new_id)
    VALUES (r.id, new_id)
    ON CONFLICT (old_id) DO UPDATE SET new_id = EXCLUDED.new_id;
  END LOOP;

  FOR r IN
    SELECT *
    FROM public.sponsorship_taxonomies
    WHERE sport = src_sport AND tier = 'ENDEMIC' AND parent_id IS NOT NULL
    ORDER BY sort_order, category
  LOOP
    INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_active, is_group, parent_id)
    VALUES (
      tgt_sport,
      r.tier,
      r.category,
      r.sort_order,
      r.is_active,
      r.is_group,
      (SELECT m.new_id FROM taxonomy_moto_gp_id_map m WHERE m.old_id = r.parent_id)
    )
    ON CONFLICT (sport, tier, category) DO UPDATE
      SET parent_id = EXCLUDED.parent_id, sort_order = EXCLUDED.sort_order;
  END LOOP;
END $$;

-- 4) Seed minimal ENDEMIC categories for six new sports
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT s.sport, 'ENDEMIC', c.category, c.sort_order
FROM (
  VALUES
    ('Cycling'),
    ('Diving'),
    ('Kitesurfing'),
    ('Softball'),
    ('Lifestyle - Breakdancing'),
    ('Marathon/Half Marathon')
) AS s(sport)
CROSS JOIN (
  VALUES
    ('Apparel', 0),
    ('Footwear', 1),
    ('Sunglasses / Eyewear', 2),
    ('Watches', 3),
    ('Energy Drinks', 4),
    ('Hydration', 5)
) AS c(category, sort_order)
ON CONFLICT (sport, tier, category) DO NOTHING;

-- 5) Resolve athlete sport → new four-wheel / moto gp parent for FK remapping
CREATE OR REPLACE FUNCTION public.taxonomy_motorsport_split_target(athlete_sport text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH norm AS (
    SELECT lower(
      regexp_replace(
        regexp_replace(
          replace(replace(replace(trim(coalesce(athlete_sport, '')), '–', '-'), '—', '-'), '−', '-'),
          '\s+',
          ' ',
          'g'
        ),
        '\s*/\s*',
        '/',
        'g'
      )
    ) AS k
  )
  SELECT CASE
    WHEN k LIKE '%two%wheel%road%race%' THEN 'Moto GP'
    WHEN k LIKE '%four%wheel%off%road%' THEN 'Four Wheel Offroad'
    WHEN k LIKE '%four%wheel%drag%' THEN 'Drag'
    WHEN k LIKE '%four%wheel%indy%'
      OR k LIKE '%four%wheel%racing%academy%f1%'
      OR k LIKE '%racing%academy%f1%' THEN 'Indy / F1'
    ELSE 'Indy / F1'
  END
  FROM norm;
$$;

-- athlete_covered_categories
UPDATE public.athlete_covered_categories acc
SET taxonomy_id = new_t.id
FROM public.sponsorship_taxonomies old_t,
     public.athletes a,
     public.sponsorship_taxonomies new_t
WHERE acc.taxonomy_id = old_t.id
  AND a.athlete_id = acc.athlete_id
  AND new_t.sport = public.taxonomy_motorsport_split_target(a.sport)
  AND new_t.tier = 'ENDEMIC'
  AND new_t.category = old_t.category
  AND old_t.sport = 'Racing / Motorsports'
  AND old_t.tier = 'ENDEMIC';

DELETE FROM public.athlete_covered_categories a
USING public.athlete_covered_categories b
WHERE a.athlete_id = b.athlete_id
  AND a.taxonomy_id = b.taxonomy_id
  AND a.ctid > b.ctid;

-- contract_exclusivities
UPDATE public.contract_exclusivities ce
SET taxonomy_id = new_t.id
FROM public.sponsorship_taxonomies old_t,
     public.contracts c,
     public.athletes a,
     public.sponsorship_taxonomies new_t
WHERE ce.taxonomy_id = old_t.id
  AND c.contract_id = ce.contract_id
  AND a.athlete_id = c.athlete_id
  AND new_t.sport = public.taxonomy_motorsport_split_target(a.sport)
  AND new_t.tier = 'ENDEMIC'
  AND new_t.category = old_t.category
  AND old_t.sport = 'Racing / Motorsports'
  AND old_t.tier = 'ENDEMIC';

DELETE FROM public.contract_exclusivities a
USING public.contract_exclusivities b
WHERE a.contract_id = b.contract_id
  AND a.taxonomy_id = b.taxonomy_id
  AND a.ctid > b.ctid;

-- crm_contacts (no athlete sport — default to Indy / F1)
UPDATE public.crm_contacts c
SET taxonomy_id = new_t.id
FROM public.sponsorship_taxonomies old_t
JOIN public.sponsorship_taxonomies new_t
  ON new_t.sport = 'Indy / F1'
  AND new_t.tier = 'ENDEMIC'
  AND new_t.category = old_t.category
WHERE c.taxonomy_id = old_t.id
  AND old_t.sport = 'Racing / Motorsports'
  AND old_t.tier = 'ENDEMIC';

-- 6) Remove Racing / Motorsports
DELETE FROM public.sponsorship_taxonomies
WHERE sport = 'Racing / Motorsports';

DROP FUNCTION IF EXISTS public.taxonomy_motorsport_split_target(text);
