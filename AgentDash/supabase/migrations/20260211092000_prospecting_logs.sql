-- Log AI-driven prospecting runs for auditing.
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

