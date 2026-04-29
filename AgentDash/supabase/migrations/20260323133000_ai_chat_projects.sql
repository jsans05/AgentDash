-- =============================================================================
-- AI chat persistence: projects, conversations, messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  memory_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.ai_projects(project_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(conversation_id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.ai_projects(project_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_projects_owner_updated
  ON public.ai_projects(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_project_updated
  ON public.ai_conversations(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created
  ON public.ai_messages(conversation_id, created_at ASC);

DROP TRIGGER IF EXISTS ai_projects_updated_at ON public.ai_projects;
CREATE TRIGGER ai_projects_updated_at
BEFORE UPDATE ON public.ai_projects
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER ai_conversations_updated_at
BEFORE UPDATE ON public.ai_conversations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_projects_select ON public.ai_projects;
DROP POLICY IF EXISTS ai_projects_insert ON public.ai_projects;
DROP POLICY IF EXISTS ai_projects_update ON public.ai_projects;
DROP POLICY IF EXISTS ai_projects_delete ON public.ai_projects;

CREATE POLICY ai_projects_select ON public.ai_projects
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

CREATE POLICY ai_projects_insert ON public.ai_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent_or_above() AND owner_user_id = auth.uid())
  );

CREATE POLICY ai_projects_update ON public.ai_projects
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

CREATE POLICY ai_projects_delete ON public.ai_projects
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_conversations_select ON public.ai_conversations;
DROP POLICY IF EXISTS ai_conversations_insert ON public.ai_conversations;
DROP POLICY IF EXISTS ai_conversations_update ON public.ai_conversations;
DROP POLICY IF EXISTS ai_conversations_delete ON public.ai_conversations;

CREATE POLICY ai_conversations_select ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

CREATE POLICY ai_conversations_insert ON public.ai_conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent_or_above() AND owner_user_id = auth.uid())
  );

CREATE POLICY ai_conversations_update ON public.ai_conversations
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

CREATE POLICY ai_conversations_delete ON public.ai_conversations
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_messages_select ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_insert ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_update ON public.ai_messages;
DROP POLICY IF EXISTS ai_messages_delete ON public.ai_messages;

CREATE POLICY ai_messages_select ON public.ai_messages
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );

CREATE POLICY ai_messages_insert ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR (public.is_agent_or_above() AND owner_user_id = auth.uid())
  );

CREATE POLICY ai_messages_update ON public.ai_messages
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

CREATE POLICY ai_messages_delete ON public.ai_messages
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR owner_user_id = auth.uid()
  );
