-- Remove exclusivity/category_id from contracts; category (text) references taxonomy categories.
ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_category_id_fkey;

ALTER TABLE public.contracts
  DROP COLUMN IF EXISTS category_id;

-- Index may have been on category_id; drop if exists
DROP INDEX IF EXISTS idx_contracts_category;
