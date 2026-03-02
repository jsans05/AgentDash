-- ============================================================================
-- Combined Migrations for Contract Archiving, Category, and Outreach Features
-- Date: 2026-02-11
-- Run this file in Supabase Dashboard SQL Editor
-- ============================================================================

-- Migration 1: Unarchive all existing contracts
-- Contracts should only be archived via explicit user action.
UPDATE public.contracts
SET archived = false
WHERE archived = true;

-- Migration 2: Add text-based category to contracts for outreach and reporting.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS category text;

-- Backfill category from existing exclusivity_categories if present.
UPDATE public.contracts c
SET category = ec.name
FROM public.exclusivity_categories ec
WHERE c.category IS NULL
  AND c.category_id = ec.category_id;

-- For any remaining rows without a category, set a temporary placeholder.
UPDATE public.contracts
SET category = 'unknown'
WHERE category IS NULL;

-- Make category required going forward.
ALTER TABLE public.contracts
  ALTER COLUMN category SET NOT NULL;

-- Drop is_exclusive; all contracts are treated as exclusive by default.
ALTER TABLE public.contracts
  DROP COLUMN IF EXISTS is_exclusive;

-- Migration 3: Log AI-driven prospecting runs for auditing.
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
