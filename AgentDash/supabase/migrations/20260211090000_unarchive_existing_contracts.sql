-- Unarchive all existing contracts.
-- Contracts should only be archived via explicit user action.
UPDATE public.contracts
SET archived = false
WHERE archived = true;

