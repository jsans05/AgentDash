-- Sales can insert CRM contacts they own (parity with crm_companies_pipeline_insert for sales).
-- Previously only admin or agent+own could insert; sales could create pipeline cards but not contacts on bulk target-list import.

DROP POLICY IF EXISTS crm_contacts_insert ON public.crm_contacts;

CREATE POLICY crm_contacts_insert ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_sales()
      AND created_by_user_id = auth.uid()
    )
    OR (
      public.is_agent()
      AND created_by_user_id = auth.uid()
    )
  );
