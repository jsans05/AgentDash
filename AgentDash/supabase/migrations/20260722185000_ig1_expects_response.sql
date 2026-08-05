-- Enable reply tracking (R button) on IG1 — Instagram follow + engage.
UPDATE public.outreach_sequence_steps
SET
  expects_response = true,
  guidance = 'Follow the company account and like/comment on a recent post. Mark R if they engage back (follow/like/comment/DM). Skip if IG is dormant.'
WHERE short_code = 'IG1'
  AND expects_response IS DISTINCT FROM true;
