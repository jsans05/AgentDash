-- Pending user-question interactions for Mystery Machine (pause/resume tool loop)

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS pending_turn jsonb;

ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;
