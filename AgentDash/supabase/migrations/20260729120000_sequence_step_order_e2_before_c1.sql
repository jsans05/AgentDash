-- Reorder first-wave steps so email 2 comes before call 1 (E1 → E2 → C1).
UPDATE public.outreach_sequence_steps
SET step_order = 99
WHERE sequence_id = 'a0000000-0000-4000-8000-000000000002'
  AND short_code = 'C1';

UPDATE public.outreach_sequence_steps
SET step_order = 5, day_offset = 8
WHERE sequence_id = 'a0000000-0000-4000-8000-000000000002'
  AND short_code = 'E2';

UPDATE public.outreach_sequence_steps
SET step_order = 6, day_offset = 10
WHERE sequence_id = 'a0000000-0000-4000-8000-000000000002'
  AND short_code = 'C1';
