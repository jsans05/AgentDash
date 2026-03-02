-- Allow contracts to be archived (hidden from main view) without terminating.
-- Archived contracts remain in the DB so users can view historical contracts.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contracts.archived IS 'When true, contract is hidden from default roster/contract views. Use Archive to hide expired contracts; Unarchive to show again.';

CREATE INDEX IF NOT EXISTS idx_contracts_archived ON public.contracts(archived);
