-- =============================================================================
-- Normalize athletes primary key to athlete_id (lowercase)
-- =============================================================================
-- Fixes: contracts/import not linking when athletes table uses "id" or "Athlete_id"
-- so that contracts.athlete_id correctly references athletes.athlete_id.
-- =============================================================================

-- Rename athletes PK to athlete_id so contracts.athlete_id can link correctly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = 'id') THEN
    ALTER TABLE public.athletes RENAME COLUMN id TO athlete_id;
    RAISE NOTICE 'Renamed public.athletes.id to athlete_id';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'athletes' AND column_name = 'Athlete_id') THEN
    ALTER TABLE public.athletes RENAME COLUMN "Athlete_id" TO athlete_id;
    RAISE NOTICE 'Renamed public.athletes."Athlete_id" to athlete_id';
  ELSE
    RAISE NOTICE 'public.athletes already has athlete_id (or no change needed)';
  END IF;
END $$;

-- Ensure contracts.athlete_id references athletes.athlete_id (if contracts exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contracts') THEN
    -- Drop FK if it points to the old column name (e.g. athletes(id))
    ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_athlete_id_fkey;
    -- Add correct FK
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'contracts'
        AND constraint_name = 'contracts_athlete_id_fkey'
    ) THEN
      ALTER TABLE public.contracts
        ADD CONSTRAINT contracts_athlete_id_fkey
        FOREIGN KEY (athlete_id) REFERENCES public.athletes(athlete_id) ON DELETE CASCADE;
      RAISE NOTICE 'Added FK contracts.athlete_id -> athletes.athlete_id';
    END IF;
  END IF;
END $$;
