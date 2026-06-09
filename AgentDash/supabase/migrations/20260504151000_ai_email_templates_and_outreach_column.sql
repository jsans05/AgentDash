-- Email generation templates + target-list outreach draft storage

ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS outreach_email text;

CREATE TABLE IF NOT EXISTS public.ai_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL UNIQUE CHECK (
    mode IN ('one_to_one', 'general_high_level', 'general_athlete_led', 'multi_athlete')
  ),
  subject_template text NOT NULL,
  body_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ai_email_templates_updated_at ON public.ai_email_templates;
CREATE TRIGGER ai_email_templates_updated_at
BEFORE UPDATE ON public.ai_email_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_email_templates_select ON public.ai_email_templates;
DROP POLICY IF EXISTS ai_email_templates_insert ON public.ai_email_templates;
DROP POLICY IF EXISTS ai_email_templates_update ON public.ai_email_templates;
DROP POLICY IF EXISTS ai_email_templates_delete ON public.ai_email_templates;

CREATE POLICY ai_email_templates_select ON public.ai_email_templates
  FOR SELECT TO authenticated
  USING (public.is_agent_or_above());

CREATE POLICY ai_email_templates_insert ON public.ai_email_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY ai_email_templates_update ON public.ai_email_templates
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY ai_email_templates_delete ON public.ai_email_templates
  FOR DELETE TO authenticated
  USING (public.is_admin());

INSERT INTO public.ai_email_templates (mode, subject_template, body_template, is_active)
VALUES
  (
    'one_to_one',
    '{{athlete_name}} x {{company_name}} partnership idea',
    E'Hi {{recipient_name}},\n\n{{past_partnership_line}}\n{{intro_line}}\n\nA few reasons this could be a fit:\n{{proof_points}}\n\n{{fit_rationale}}\n\n{{cta}}\n\nLooking forward to hearing from you,',
    true
  ),
  (
    'general_high_level',
    'Partnership opportunities with The Team roster',
    E'Hi {{recipient_name}},\n\n{{intro_line}}\n\nWhy this is relevant now:\n{{proof_points}}\n\n{{cta}}\n\nLooking forward to hearing from you,',
    true
  ),
  (
    'general_athlete_led',
    '{{lead_athletes}} x {{company_name}} partnership opportunity',
    E'Hi {{recipient_name}},\n\n{{intro_line}}\n\nAthlete-led reasons this can work:\n{{proof_points}}\n\n{{cta}}\n\nLooking forward to hearing from you,',
    true
  ),
  (
    'multi_athlete',
    '{{lead_athletes}} x {{company_name}} campaign concept',
    E'Hi {{recipient_name}},\n\n{{intro_line}}\n\nPotential athlete lineup:\n{{proof_points}}\n\n{{cta}}\n\nLooking forward to hearing from you,',
    true
  )
ON CONFLICT (mode) DO NOTHING;
