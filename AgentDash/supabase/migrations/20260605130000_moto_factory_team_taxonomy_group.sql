-- Group Supercross / Motocross (Moto) parts categories under ENDEMIC folder "Factory Team".

INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order, is_group, parent_id)
SELECT 'Supercross / Motocross (Moto)', 'ENDEMIC', 'Factory Team', 2, true, NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sponsorship_taxonomies
  WHERE sport = 'Supercross / Motocross (Moto)'
    AND tier = 'ENDEMIC'
    AND category = 'Factory Team'
    AND is_group = true
);

-- If a non-group row named "Factory Team" exists, promote it to a group.
UPDATE public.sponsorship_taxonomies
SET is_group = true, parent_id = NULL
WHERE sport = 'Supercross / Motocross (Moto)'
  AND tier = 'ENDEMIC'
  AND category = 'Factory Team'
  AND is_group = false;

WITH factory_team AS (
  SELECT id
  FROM public.sponsorship_taxonomies
  WHERE sport = 'Supercross / Motocross (Moto)'
    AND tier = 'ENDEMIC'
    AND category = 'Factory Team'
    AND is_group = true
  LIMIT 1
),
children AS (
  SELECT
    t.id,
    row_number() OVER (ORDER BY t.sort_order ASC, t.category ASC) - 1 AS child_sort
  FROM public.sponsorship_taxonomies t
  WHERE t.sport = 'Supercross / Motocross (Moto)'
    AND t.tier = 'ENDEMIC'
    AND t.is_group = false
    AND t.category IN (
      'Exhaust Systems',
      'Suspension (forks, shocks)',
      'Wheels & Rims',
      'Tires',
      'Brakes',
      'Engine Performance Parts',
      'Clutches & Drivetrain',
      'Handlebars & Controls',
      'Foot Pegs',
      'Radiators & Cooling Systems',
      'Electronics / ECU / Mapping',
      'Aftermarket Plastics & Body Kits'
    )
)
UPDATE public.sponsorship_taxonomies t
SET
  parent_id = ft.id,
  sort_order = c.child_sort
FROM children c
CROSS JOIN factory_team ft
WHERE t.id = c.id;
