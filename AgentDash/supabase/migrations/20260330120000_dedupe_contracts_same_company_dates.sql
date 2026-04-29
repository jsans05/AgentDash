-- Remove duplicate contracts per athlete where company and date range match.
-- Keeps one row per (athlete_id, company_id, start_date, end_date): prefer
-- non-archived, then earliest created_at, then smallest contract_id.
-- Taxonomy links from dropped rows are merged onto the keeper (ON CONFLICT DO NOTHING).

WITH ranked AS (
  SELECT
    contract_id,
    athlete_id,
    company_id,
    start_date,
    end_date,
    ROW_NUMBER() OVER (
      PARTITION BY athlete_id, company_id, start_date, end_date
      ORDER BY archived ASC, created_at ASC, contract_id ASC
    ) AS rn
  FROM public.contracts
),
keepers AS (
  SELECT athlete_id, company_id, start_date, end_date, contract_id AS keeper_id
  FROM ranked
  WHERE rn = 1
),
to_drop AS (
  SELECT r.contract_id, k.keeper_id
  FROM ranked r
  INNER JOIN keepers k
    ON r.athlete_id = k.athlete_id
    AND r.company_id = k.company_id
    AND r.start_date IS NOT DISTINCT FROM k.start_date
    AND r.end_date IS NOT DISTINCT FROM k.end_date
  WHERE r.rn > 1
)
INSERT INTO public.contract_exclusivities (contract_id, taxonomy_id)
SELECT td.keeper_id, ce.taxonomy_id
FROM public.contract_exclusivities ce
INNER JOIN to_drop td ON td.contract_id = ce.contract_id
ON CONFLICT (contract_id, taxonomy_id) DO NOTHING;

WITH ranked AS (
  SELECT
    contract_id,
    athlete_id,
    company_id,
    start_date,
    end_date,
    ROW_NUMBER() OVER (
      PARTITION BY athlete_id, company_id, start_date, end_date
      ORDER BY archived ASC, created_at ASC, contract_id ASC
    ) AS rn
  FROM public.contracts
)
DELETE FROM public.contracts c
USING ranked r
WHERE c.contract_id = r.contract_id
  AND r.rn > 1;

-- Prevent the same athlete/company/date range from being inserted twice (PostgreSQL 15+).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_dedupe_athlete_company_dates
ON public.contracts (athlete_id, company_id, start_date, end_date)
NULLS NOT DISTINCT;
