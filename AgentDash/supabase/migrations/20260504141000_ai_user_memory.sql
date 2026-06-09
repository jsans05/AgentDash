-- =============================================================================
-- AI user memory: global and project-scoped persistent memory rows
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_user_memory (
  memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global', 'project')),
  project_id uuid REFERENCES public.ai_projects(project_id) ON DELETE CASCADE,
  memory_text text NOT NULL CHECK (char_length(memory_text) BETWEEN 1 AND 1000),
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  is_active boolean NOT NULL DEFAULT true,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_user_memory_scope_project_ck CHECK (
    (scope = 'global' AND project_id IS NULL)
    OR (scope = 'project' AND project_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_user_memory_owner_scope_project_text_unique
  ON public.ai_user_memory (
    owner_user_id,
    scope,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(memory_text)
  );

CREATE INDEX IF NOT EXISTS idx_ai_user_memory_owner_scope_updated
  ON public.ai_user_memory(owner_user_id, scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_user_memory_owner_project_updated
  ON public.ai_user_memory(owner_user_id, project_id, updated_at DESC);

DROP TRIGGER IF EXISTS ai_user_memory_updated_at ON public.ai_user_memory;
CREATE TRIGGER ai_user_memory_updated_at
BEFORE UPDATE ON public.ai_user_memory
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_user_memory_select ON public.ai_user_memory;
DROP POLICY IF EXISTS ai_user_memory_insert ON public.ai_user_memory;
DROP POLICY IF EXISTS ai_user_memory_update ON public.ai_user_memory;
DROP POLICY IF EXISTS ai_user_memory_delete ON public.ai_user_memory;

CREATE POLICY ai_user_memory_select ON public.ai_user_memory
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

CREATE POLICY ai_user_memory_insert ON public.ai_user_memory
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent_or_above() AND owner_user_id = auth.uid())
  );

CREATE POLICY ai_user_memory_update ON public.ai_user_memory
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

CREATE POLICY ai_user_memory_delete ON public.ai_user_memory
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );
