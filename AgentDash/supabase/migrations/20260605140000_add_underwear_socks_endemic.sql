-- Add Underwear and Socks as separate ENDEMIC categories for every sport.
-- Insert immediately after Apparel when present; otherwise append after max endemic sort_order.

WITH endemic_sports AS (
  SELECT DISTINCT sport
  FROM public.sponsorship_taxonomies
  WHERE tier = 'ENDEMIC'
    AND sport <> '__NON_ENDEMIC_GLOBAL__'
),
placement AS (
  SELECT
    s.sport,
    COALESCE(a.sort_order, m.max_sort, -1) AS after_order
  FROM endemic_sports s
  LEFT JOIN public.sponsorship_taxonomies a
    ON a.sport = s.sport
    AND a.tier = 'ENDEMIC'
    AND a.category = 'Apparel'
    AND a.is_group = false
  LEFT JOIN (
    SELECT sport, MAX(sort_order) AS max_sort
    FROM public.sponsorship_taxonomies
    WHERE tier = 'ENDEMIC'
      AND is_group = false
    GROUP BY sport
  ) m ON m.sport = s.sport
),
shifted AS (
  UPDATE public.sponsorship_taxonomies t
  SET sort_order = t.sort_order + 2
  FROM placement p
  WHERE t.sport = p.sport
    AND t.tier = 'ENDEMIC'
    AND t.is_group = false
    AND t.sort_order > p.after_order
    AND t.category NOT IN ('Underwear', 'Socks')
    AND NOT EXISTS (
      SELECT 1
      FROM public.sponsorship_taxonomies u
      WHERE u.sport = p.sport
        AND u.tier = 'ENDEMIC'
        AND u.category IN ('Underwear', 'Socks')
    )
  RETURNING t.sport
)
INSERT INTO public.sponsorship_taxonomies (sport, tier, category, sort_order)
SELECT p.sport, 'ENDEMIC', cat.category, p.after_order + cat.offset
FROM placement p
CROSS JOIN (
  VALUES ('Underwear', 1), ('Socks', 2)
) AS cat(category, offset)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sponsorship_taxonomies x
  WHERE x.sport = p.sport
    AND x.tier = 'ENDEMIC'
    AND x.category = cat.category
)
ON CONFLICT (sport, tier, category) DO NOTHING;
