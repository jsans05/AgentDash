-- Sales could read crm_contacts but could not UPDATE (e.g. email_drafts from Mystery Machine).
-- Align UPDATE with SELECT visibility so pipeline drafting can persist per-contact drafts.

DROP POLICY IF EXISTS crm_contacts_update ON public.crm_contacts;

CREATE POLICY crm_contacts_update ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent() AND created_by_user_id = auth.uid())
  );
