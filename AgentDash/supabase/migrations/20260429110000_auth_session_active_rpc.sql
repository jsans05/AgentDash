-- =============================================================================
-- Session activity helper for app-level auth validation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_auth_session_active(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = p_session_id
      AND s.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_auth_session_active(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_auth_session_active(uuid, uuid) TO service_role;
