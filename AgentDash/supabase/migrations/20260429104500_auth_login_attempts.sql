-- =============================================================================
-- Login Attempt Tracking for App-Level Auth Lockout
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_type text NOT NULL CHECK (bucket_type IN ('email', 'ip')),
  bucket_hash text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_attempts_bucket_unique UNIQUE (bucket_type, bucket_hash)
);

COMMENT ON TABLE public.auth_login_attempts IS
  'Hashed login attempt buckets used for app-level auth throttling and lockout.';

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_locked_until
  ON public.auth_login_attempts (locked_until);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_last_failed_at
  ON public.auth_login_attempts (last_failed_at);

DROP TRIGGER IF EXISTS auth_login_attempts_updated_at ON public.auth_login_attempts;
CREATE TRIGGER auth_login_attempts_updated_at
BEFORE UPDATE ON public.auth_login_attempts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
