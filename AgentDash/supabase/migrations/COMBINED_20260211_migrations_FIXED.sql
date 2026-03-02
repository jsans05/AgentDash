-- ============================================================================
-- Combined Migrations for Contract Archiving, Category, and Outreach Features
-- Date: 2026-02-11 (Fixed version)
-- Run this file in Supabase Dashboard SQL Editor
-- ============================================================================

-- Step 1: Add archived column if it doesn't exist (from previous migration)
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contracts_archived ON public.contracts(archived);

-- Step 2: Unarchive all existing contracts
-- Contracts should only be archived via explicit user action.
UPDATE public.contracts
SET archived = false
WHERE archived = true;

-- Step 3: Add text-based category to contracts for outreach and reporting.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS category text;

-- Step 4: Backfill category from existing exclusivity_categories if present.
UPDATE public.contracts c
SET category = ec.name
FROM public.exclusivity_categories ec
WHERE c.category IS NULL
  AND c.category_id = ec.category_id;

-- Step 5: For any remaining rows without a category, set a temporary placeholder.
UPDATE public.contracts
SET category = 'unknown'
WHERE category IS NULL;

-- Step 6: Make category required going forward.
ALTER TABLE public.contracts
  ALTER COLUMN category SET NOT NULL;

-- Step 7: Drop is_exclusive if it exists (all contracts are treated as exclusive by default).
ALTER TABLE public.contracts
  DROP COLUMN IF EXISTS is_exclusive;

-- Step 8: Create prospecting_logs table for AI-driven prospecting runs.
CREATE TABLE IF NOT EXISTS public.prospecting_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  categories_present text[] NOT NULL,
  categories_missing text[] NOT NULL,
  companies jsonb,
  sources text[],
  request_messages jsonb,
  response_text text
);

CREATE INDEX IF NOT EXISTS idx_prospecting_logs_athlete_id ON public.prospecting_logs(athlete_id);
CREATE INDEX IF NOT EXISTS idx_prospecting_logs_user_id ON public.prospecting_logs(user_id);

-- ============================================================================
-- Migration Complete
-- ============================================================================
