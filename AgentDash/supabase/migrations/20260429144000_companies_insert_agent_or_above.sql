-- Allow agents (and admin/sales) to create companies during CRM target-list imports.
-- Existing SELECT/UPDATE/DELETE policies remain unchanged.

DROP POLICY IF EXISTS "companies_insert_admin" ON public.companies;

CREATE POLICY "companies_insert_agent_or_above" ON public.companies
  FOR INSERT
  WITH CHECK (public.is_agent_or_above());
