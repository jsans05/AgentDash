-- Market intelligence: NASCAR Cup standings, team sponsors, venue sponsors

CREATE TABLE IF NOT EXISTS public.market_intel_cup_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_year integer NOT NULL,
  series text NOT NULL DEFAULT 'nascar-cup-series',
  position integer,
  car_no text NOT NULL,
  driver_name text NOT NULL,
  driver_id integer,
  manufacturer text,
  owner_name text,
  owner_id integer,
  team_name text,
  owner_entity_key text,
  nascar_team_page_url text,
  team_website_url text,
  driver_page_url text,
  points integer,
  stage_points integer,
  behind integer,
  starts integer,
  poles integer,
  wins integer,
  top_5 integer,
  top_10 integer,
  dnfs integer,
  laps_led integer,
  scraped_at timestamptz,
  source_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_year, car_no, driver_id)
);

CREATE TABLE IF NOT EXISTS public.market_intel_team_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key text NOT NULL,
  owner_name text NOT NULL,
  team_name text,
  team_website_url text,
  nascar_team_page_url text,
  company_name text NOT NULL,
  company_name_normalized text NOT NULL,
  display_name text NOT NULL,
  sponsor_url text,
  extraction_method text,
  season_year integer,
  scraped_at timestamptz,
  source_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_key, company_name_normalized)
);

CREATE TABLE IF NOT EXISTS public.market_intel_venues (
  entity_key text PRIMARY KEY,
  name text NOT NULL,
  sport_type text,
  sponsor_page_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_intel_venue_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key text NOT NULL REFERENCES public.market_intel_venues(entity_key) ON DELETE CASCADE,
  venue_name text NOT NULL,
  sport_type text,
  sponsor_page_url text,
  company_name text NOT NULL,
  company_name_normalized text NOT NULL,
  display_name text NOT NULL,
  sponsor_url text,
  extraction_method text,
  scraped_at timestamptz,
  source_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_key, company_name_normalized)
);

CREATE TABLE IF NOT EXISTS public.market_intel_scrape_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  finished_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_intel_cup_drivers_position
  ON public.market_intel_cup_drivers (season_year, position);
CREATE INDEX IF NOT EXISTS idx_market_intel_team_sponsors_owner
  ON public.market_intel_team_sponsors (owner_name);
CREATE INDEX IF NOT EXISTS idx_market_intel_venue_sponsors_venue
  ON public.market_intel_venue_sponsors (venue_name);

ALTER TABLE public.market_intel_cup_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_intel_team_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_intel_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_intel_venue_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_intel_scrape_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers;
CREATE POLICY "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers
  FOR SELECT USING (public.is_admin() OR public.is_sales());

DROP POLICY IF EXISTS "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors;
CREATE POLICY "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales());

DROP POLICY IF EXISTS "market_intel_venues_admin_sales_read" ON public.market_intel_venues;
CREATE POLICY "market_intel_venues_admin_sales_read" ON public.market_intel_venues
  FOR SELECT USING (public.is_admin() OR public.is_sales());

DROP POLICY IF EXISTS "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors;
CREATE POLICY "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales());

DROP POLICY IF EXISTS "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs;
CREATE POLICY "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs
  FOR SELECT USING (public.is_admin() OR public.is_sales());

COMMENT ON TABLE public.market_intel_cup_drivers IS 'NASCAR Cup Series driver standings snapshots from market_sponsor_intel scraper.';
COMMENT ON TABLE public.market_intel_team_sponsors IS 'Sponsors/partners scraped from NASCAR team websites.';
COMMENT ON TABLE public.market_intel_venues IS 'Configured stadium/race venues for sponsor scraping.';
COMMENT ON TABLE public.market_intel_venue_sponsors IS 'Sponsors/partners scraped from venue websites.';
