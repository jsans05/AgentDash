-- Per-user outreach tone reference emails (max 3 per user)

CREATE TABLE IF NOT EXISTS public.ai_email_tone_samples (
  sample_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  sample_index smallint NOT NULL CHECK (sample_index BETWEEN 1 AND 3),
  sample_title text,
  sample_content text NOT NULL CHECK (char_length(sample_content) BETWEEN 20 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_email_tone_samples_owner_idx_unique UNIQUE (owner_user_id, sample_index)
);

DROP TRIGGER IF EXISTS ai_email_tone_samples_updated_at ON public.ai_email_tone_samples;
CREATE TRIGGER ai_email_tone_samples_updated_at
BEFORE UPDATE ON public.ai_email_tone_samples
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_email_tone_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_email_tone_samples_select ON public.ai_email_tone_samples;
DROP POLICY IF EXISTS ai_email_tone_samples_insert ON public.ai_email_tone_samples;
DROP POLICY IF EXISTS ai_email_tone_samples_update ON public.ai_email_tone_samples;
DROP POLICY IF EXISTS ai_email_tone_samples_delete ON public.ai_email_tone_samples;

CREATE POLICY ai_email_tone_samples_select ON public.ai_email_tone_samples
  FOR SELECT TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
  );

CREATE POLICY ai_email_tone_samples_insert ON public.ai_email_tone_samples
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
  );

CREATE POLICY ai_email_tone_samples_update ON public.ai_email_tone_samples
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
  );

CREATE POLICY ai_email_tone_samples_delete ON public.ai_email_tone_samples
  FOR DELETE TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_admin()
    OR public.is_sales()
  );
