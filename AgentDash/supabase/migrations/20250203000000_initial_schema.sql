-- =============================================================================
-- AgentDash MVP Schema
-- =============================================================================
-- Production-minded MVP for sports agency dashboard
-- =============================================================================

-- Drop old conflicting tables from previous migrations (if they exist)
-- These are from the old dashboard schema; AgentDash uses a new normalized schema
DROP TABLE IF EXISTS public.outreach_recommendations CASCADE;
DROP TABLE IF EXISTS public.sponsorships CASCADE;
DROP TABLE IF EXISTS public.athlete_social_metrics CASCADE;
DROP TABLE IF EXISTS public.athlete_audience_stats CASCADE;
DROP TABLE IF EXISTS public.athletes CASCADE;  -- Old schema (id, agent_id)
DROP TABLE IF EXISTS public.agents CASCADE;     -- Old schema (id, user_id, full_name)

-- Note: Keeping public."Agents" and public."Athletes" (quoted, from roster import)
-- as they are separate tables. AgentDash uses public.profiles and public.athletes (new schema).

-- -----------------------------------------------------------------------------
-- 1. PROFILES (maps auth users to roles)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'sales', 'agent')),
  first_name text,
  last_name text,
  email text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

COMMENT ON TABLE public.profiles IS 'User profiles with RBAC roles: admin (full access), sales (read-only all), agent (own athletes only).';

-- -----------------------------------------------------------------------------
-- 2. ATHLETES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athletes (
  athlete_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_agent_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  sport text,
  city text,
  state text,
  country text,
  creatoriq_publisher_id text,
  accolades text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_athletes_agent ON public.athletes(current_agent_id);
CREATE INDEX IF NOT EXISTS idx_athletes_name ON public.athletes(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_athletes_creatoriq ON public.athletes(creatoriq_publisher_id);

COMMENT ON TABLE public.athletes IS 'Athletes managed by agents. current_agent_id can be reassigned by admin.';

-- -----------------------------------------------------------------------------
-- 3. ATHLETE_AGENT_HISTORY (audit reassignments)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_agent_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  from_agent_id uuid REFERENCES public.profiles(user_id),
  to_agent_id uuid REFERENCES public.profiles(user_id),
  changed_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  changed_at timestamptz DEFAULT now() NOT NULL,
  note text
);

CREATE INDEX IF NOT EXISTS idx_athlete_agent_history_athlete ON public.athlete_agent_history(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_agent_history_changed_by ON public.athlete_agent_history(changed_by_user_id);

COMMENT ON TABLE public.athlete_agent_history IS 'Audit log of athlete reassignments (admin-only inserts).';

-- -----------------------------------------------------------------------------
-- 4. COMPANIES (drop and recreate if exists from old schema)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.companies CASCADE;
CREATE TABLE public.companies (
  company_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  industry text,
  website text,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON public.companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON public.companies(industry);

COMMENT ON TABLE public.companies IS 'Sponsor companies. Shared across all agents.';

-- -----------------------------------------------------------------------------
-- 5. COMPANY_CONTACTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(company_id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.profiles(user_id),
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_company_contacts_company ON public.company_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_company_contacts_agent ON public.company_contacts(agent_id);

COMMENT ON TABLE public.company_contacts IS 'Contact info at companies, owned by specific agents.';

-- -----------------------------------------------------------------------------
-- 6. EXCLUSIVITY_CATEGORIES (admin-managed dropdown)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exclusivity_categories (
  category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exclusivity_categories_name ON public.exclusivity_categories(name);

COMMENT ON TABLE public.exclusivity_categories IS 'Admin-managed exclusivity categories (e.g. Energy Drink, Apparel).';

-- -----------------------------------------------------------------------------
-- 7. CONTRACTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contracts (
  contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(company_id),
  category_id uuid NOT NULL REFERENCES public.exclusivity_categories(category_id),
  is_exclusive boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated')),
  notes text,
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_athlete_status ON public.contracts(athlete_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_company ON public.contracts(company_id);
CREATE INDEX IF NOT EXISTS idx_contracts_category ON public.contracts(category_id);

COMMENT ON TABLE public.contracts IS 'Sponsorship contracts. Supports multiple sponsors per athlete with exclusivity tracking.';

-- -----------------------------------------------------------------------------
-- 8. CREATORIQ_SNAPSHOTS (raw JSON storage)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creatoriq_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(athlete_id) ON DELETE CASCADE,
  fetched_at timestamptz DEFAULT now() NOT NULL,
  snapshot_type text NOT NULL CHECK (snapshot_type IN ('audience', 'social', 'publisher', 'accounts', 'other')),
  raw_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ciq_snapshots_athlete_time ON public.creatoriq_snapshots(athlete_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_ciq_snapshots_type ON public.creatoriq_snapshots(snapshot_type);
CREATE INDEX IF NOT EXISTS idx_ciq_snapshots_athlete_type ON public.creatoriq_snapshots(athlete_id, snapshot_type, fetched_at DESC);

COMMENT ON TABLE public.creatoriq_snapshots IS 'CreatorIQ data snapshots stored as raw JSON. Refresh monthly + on-demand.';

-- -----------------------------------------------------------------------------
-- 9. TRIGGERS: updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS athletes_updated_at ON public.athletes;
DROP TRIGGER IF EXISTS contracts_updated_at ON public.contracts;
CREATE TRIGGER athletes_updated_at BEFORE UPDATE ON public.athletes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
