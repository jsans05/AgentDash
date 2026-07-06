-- Allow consulting profile members to read market intel data

CREATE OR REPLACE FUNCTION public.is_consulting_user()
RETURNS boolean AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.consulting_profile_members m
      WHERE m.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers;
CREATE POLICY "market_intel_cup_drivers_admin_sales_read" ON public.market_intel_cup_drivers
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors;
CREATE POLICY "market_intel_team_sponsors_admin_sales_read" ON public.market_intel_team_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_venues_admin_sales_read" ON public.market_intel_venues;
CREATE POLICY "market_intel_venues_admin_sales_read" ON public.market_intel_venues
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors;
CREATE POLICY "market_intel_venue_sponsors_admin_sales_read" ON public.market_intel_venue_sponsors
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs;
CREATE POLICY "market_intel_scrape_runs_admin_sales_read" ON public.market_intel_scrape_runs
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());

DROP POLICY IF EXISTS "market_intel_brand_enrichment_admin_sales_read"
  ON public.market_intel_brand_enrichment;
CREATE POLICY "market_intel_brand_enrichment_admin_sales_read"
  ON public.market_intel_brand_enrichment
  FOR SELECT USING (public.is_admin() OR public.is_sales() OR public.is_consulting_user());
