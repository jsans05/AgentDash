-- =============================================================================
-- Add foreign keys from contracts to athletes, companies, exclusivity_categories
-- =============================================================================
-- Fixes: contracts.athlete_id and company_id "not connected" so the app can
-- join and display contracts under Contracts tab and on athlete pages.
-- =============================================================================

-- 1. contracts.athlete_id -> athletes (support both athletes.athlete_id and athletes.id)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contracts')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'athletes') THEN
    ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_athlete_id_fkey;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = 'athlete_id') THEN
      ALTER TABLE public.contracts
        ADD CONSTRAINT contracts_athlete_id_fkey
        FOREIGN KEY (athlete_id) REFERENCES public.athletes(athlete_id) ON DELETE CASCADE;
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = 'id') THEN
      ALTER TABLE public.contracts
        ADD CONSTRAINT contracts_athlete_id_fkey
        FOREIGN KEY (athlete_id) REFERENCES public.athletes(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- 2. contracts.company_id -> companies
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contracts')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_company_id_fkey;
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(company_id);
  END IF;
END $$;

-- 3. contracts.category_id -> exclusivity_categories
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contracts')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'exclusivity_categories') THEN
    ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_category_id_fkey;
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.exclusivity_categories(category_id);
  END IF;
END $$;
