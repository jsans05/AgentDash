-- =============================================================================
-- Multi-channel outreach sequence engine, variants, events, timezone
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Timezone columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.crm_companies_pipeline
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS sequence_id uuid,
  ADD COLUMN IF NOT EXISTS sequence_started_at timestamptz;

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.crm_companies_pipeline.timezone IS
  'IANA timezone for the prospect company (e.g. America/Los_Angeles). Used for local-time outreach analytics.';
COMMENT ON COLUMN public.crm_contacts.timezone IS
  'IANA timezone for the contact. Overrides pipeline card timezone when logging contact-level touches.';

-- -----------------------------------------------------------------------------
-- 2) Sequence definitions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

DROP TRIGGER IF EXISTS outreach_sequences_updated_at ON public.outreach_sequences;
CREATE TRIGGER outreach_sequences_updated_at
BEFORE UPDATE ON public.outreach_sequences
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.outreach_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  day_offset integer NOT NULL,
  channel text NOT NULL CHECK (
    channel IN (
      'cold_email',
      'support_email',
      'instagram_dm',
      'instagram_engage',
      'linkedin',
      'cold_call'
    )
  ),
  action_label text NOT NULL,
  short_code text NOT NULL,
  phase text NOT NULL DEFAULT 'wave',
  expects_response boolean NOT NULL DEFAULT false,
  is_optional boolean NOT NULL DEFAULT false,
  guidance text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order),
  UNIQUE (sequence_id, short_code)
);

CREATE INDEX IF NOT EXISTS idx_outreach_sequence_steps_sequence
  ON public.outreach_sequence_steps(sequence_id, step_order);

-- Seed sequence v2 (19-day / multi-channel)
INSERT INTO public.outreach_sequences (id, name, version, is_active)
VALUES ('a0000000-0000-4000-8000-000000000002', 'Multi-Channel Outreach', 2, true)
ON CONFLICT (name, version) DO NOTHING;

INSERT INTO public.outreach_sequence_steps (
  id,
  sequence_id,
  step_order,
  day_offset,
  channel,
  action_label,
  short_code,
  phase,
  expects_response,
  is_optional,
  guidance
)
VALUES
  (
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    1, 1, 'linkedin', 'View profile (personal account)', 'LI1', 'warm_up', false, false,
    'Warm-up only - no ask. View their LinkedIn profile from your personal account.'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000002',
    2, 2, 'linkedin', 'Comment on a recent post', 'LI2', 'warm_up', false, false,
    'Leave a genuine comment on a recent post. No pitch.'
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    3, 4, 'linkedin', 'Blank connection request', 'LI3', 'warm_up', true, false,
    'Send a blank connection request. Mark response green if they accept.'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000002',
    4, 6, 'cold_email', 'Email 1 - hook (under 100 words)', 'E1', 'first_wave', true, false,
    'Under 100 words, one problem, open question.'
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000002',
    5, 8, 'cold_call', 'Call 1 - 4-5 PM window', 'C1', 'first_wave', true, false,
    'Call in the 4-5 PM recipient-local window. Leave voicemail if no answer.'
  ),
  (
    'b0000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000002',
    6, 10, 'cold_email', 'Email 2 - reply in thread', 'E2', 'first_wave', true, false,
    'Reply in the same thread with one-line social proof.'
  ),
  (
    'b0000000-0000-4000-8000-000000000007',
    'a0000000-0000-4000-8000-000000000002',
    7, 12, 'instagram_engage', 'Instagram follow + engage', 'IG1', 'channel_switch', false, true,
    'Follow the company account and like/comment on a recent post. Skip if IG is dormant.'
  ),
  (
    'b0000000-0000-4000-8000-000000000008',
    'a0000000-0000-4000-8000-000000000002',
    8, 13, 'linkedin', 'LinkedIn message (if connected)', 'LI4', 'channel_switch', true, false,
    'Message only if connected - non-pitch question. Skip if LI3 connection was declined.'
  ),
  (
    'b0000000-0000-4000-8000-000000000009',
    'a0000000-0000-4000-8000-000000000002',
    9, 14, 'support_email', 'Support email - genuine question', 'SE1', 'channel_switch', true, false,
    'Ask something answerable about their product/service - not a sales pitch. Goal: human reply or internal forward.'
  ),
  (
    'b0000000-0000-4000-8000-00000000000a',
    'a0000000-0000-4000-8000-000000000002',
    10, 15, 'cold_call', 'Call 2 - 9-10 AM window', 'C2', 'channel_switch', true, false,
    'Second call attempt, different time window (9-10 AM recipient-local).'
  ),
  (
    'b0000000-0000-4000-8000-00000000000b',
    'a0000000-0000-4000-8000-000000000002',
    11, 17, 'instagram_dm', 'Instagram DM', 'IG2', 'channel_switch', true, true,
    'Short casual DM referencing their content. Skip if recent posts have no engagement.'
  ),
  (
    'b0000000-0000-4000-8000-00000000000c',
    'a0000000-0000-4000-8000-000000000002',
    12, 19, 'cold_email', 'Breakup message (email or LinkedIn)', 'BK1', 'exit', true, false,
    'Breakup message via email or LinkedIn. Only due if nothing responded yet.'
  )
ON CONFLICT (sequence_id, step_order) DO NOTHING;

-- FK from pipeline cards to sequences (after seed so default can reference it)
ALTER TABLE public.crm_companies_pipeline
  DROP CONSTRAINT IF EXISTS crm_companies_pipeline_sequence_id_fkey;

ALTER TABLE public.crm_companies_pipeline
  ADD CONSTRAINT crm_companies_pipeline_sequence_id_fkey
  FOREIGN KEY (sequence_id) REFERENCES public.outreach_sequences(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 3) Per-card sequence state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_card_sequence_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.crm_companies_pipeline(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.outreach_sequence_steps(id) ON DELETE CASCADE,
  touch_status text NOT NULL DEFAULT 'pending'
    CHECK (touch_status IN ('pending', 'done', 'skipped')),
  response_status text NOT NULL DEFAULT 'awaiting'
    CHECK (response_status IN ('awaiting', 'responded', 'no_response')),
  done_at timestamptz,
  variant_id uuid,
  outcome text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, step_id)
);

DROP TRIGGER IF EXISTS crm_card_sequence_state_updated_at ON public.crm_card_sequence_state;
CREATE TRIGGER crm_card_sequence_state_updated_at
BEFORE UPDATE ON public.crm_card_sequence_state
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_crm_card_sequence_state_card
  ON public.crm_card_sequence_state(card_id);
CREATE INDEX IF NOT EXISTS idx_crm_card_sequence_state_step
  ON public.crm_card_sequence_state(step_id);

-- -----------------------------------------------------------------------------
-- 4) Outreach variants (A/B/C paste-in library — separate from ai_email_templates)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  variant_label text NOT NULL CHECK (variant_label IN ('A', 'B', 'C', 'D', 'E')),
  name text,
  channel text NOT NULL CHECK (
    channel IN (
      'cold_email',
      'support_email',
      'instagram_dm',
      'instagram_engage',
      'linkedin',
      'cold_call'
    )
  ),
  sequence_step_id uuid REFERENCES public.outreach_sequence_steps(id) ON DELETE SET NULL,
  subject text,
  body text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS outreach_variants_updated_at ON public.outreach_variants;
CREATE TRIGGER outreach_variants_updated_at
BEFORE UPDATE ON public.outreach_variants
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_outreach_variants_user_channel
  ON public.outreach_variants(created_by_user_id, channel)
  WHERE is_active = true AND archived = false;

ALTER TABLE public.crm_card_sequence_state
  DROP CONSTRAINT IF EXISTS crm_card_sequence_state_variant_id_fkey;

ALTER TABLE public.crm_card_sequence_state
  ADD CONSTRAINT crm_card_sequence_state_variant_id_fkey
  FOREIGN KEY (variant_id) REFERENCES public.outreach_variants(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 5) Unified outreach events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_card_id uuid REFERENCES public.crm_companies_pipeline(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.crm_contacts(contact_id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('touch', 'response')),
  channel text NOT NULL CHECK (
    channel IN (
      'cold_email',
      'support_email',
      'instagram_dm',
      'instagram_engage',
      'linkedin',
      'cold_call',
      'other'
    )
  ),
  sequence_step_id uuid REFERENCES public.outreach_sequence_steps(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.outreach_variants(id) ON DELETE SET NULL,
  product_category text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text,
  responding_to_event_id uuid REFERENCES public.crm_outreach_events(id) ON DELETE SET NULL,
  notes text,
  recipient_timezone text,
  recipient_local_hour smallint CHECK (recipient_local_hour IS NULL OR (recipient_local_hour >= 0 AND recipient_local_hour <= 23)),
  recipient_local_dow smallint CHECK (recipient_local_dow IS NULL OR (recipient_local_dow >= 0 AND recipient_local_dow <= 6)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_card
  ON public.crm_outreach_events(pipeline_card_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_contact
  ON public.crm_outreach_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_user
  ON public.crm_outreach_events(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_channel
  ON public.crm_outreach_events(channel);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_variant
  ON public.crm_outreach_events(variant_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_step
  ON public.crm_outreach_events(sequence_step_id);
CREATE INDEX IF NOT EXISTS idx_crm_outreach_events_occurred
  ON public.crm_outreach_events(occurred_at DESC);

-- -----------------------------------------------------------------------------
-- 6) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_card_sequence_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outreach_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outreach_sequences_select ON public.outreach_sequences;
CREATE POLICY outreach_sequences_select ON public.outreach_sequences
  FOR SELECT TO authenticated
  USING (public.is_agent_or_above());

DROP POLICY IF EXISTS outreach_sequences_admin_write ON public.outreach_sequences;
CREATE POLICY outreach_sequences_admin_write ON public.outreach_sequences
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS outreach_sequence_steps_select ON public.outreach_sequence_steps;
CREATE POLICY outreach_sequence_steps_select ON public.outreach_sequence_steps
  FOR SELECT TO authenticated
  USING (public.is_agent_or_above());

DROP POLICY IF EXISTS outreach_sequence_steps_admin_write ON public.outreach_sequence_steps;
CREATE POLICY outreach_sequence_steps_admin_write ON public.outreach_sequence_steps
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS crm_card_sequence_state_select ON public.crm_card_sequence_state;
CREATE POLICY crm_card_sequence_state_select ON public.crm_card_sequence_state
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_companies_pipeline p
      WHERE p.id = crm_card_sequence_state.card_id
        AND p.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crm_card_sequence_state_insert ON public.crm_card_sequence_state;
CREATE POLICY crm_card_sequence_state_insert ON public.crm_card_sequence_state
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_companies_pipeline p
      WHERE p.id = crm_card_sequence_state.card_id
        AND p.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crm_card_sequence_state_update ON public.crm_card_sequence_state;
CREATE POLICY crm_card_sequence_state_update ON public.crm_card_sequence_state
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_companies_pipeline p
      WHERE p.id = crm_card_sequence_state.card_id
        AND p.created_by_user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.crm_companies_pipeline p
      WHERE p.id = crm_card_sequence_state.card_id
        AND p.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS outreach_variants_select ON public.outreach_variants;
CREATE POLICY outreach_variants_select ON public.outreach_variants
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS outreach_variants_insert ON public.outreach_variants;
CREATE POLICY outreach_variants_insert ON public.outreach_variants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_agent_or_above()
    AND created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS outreach_variants_update ON public.outreach_variants;
CREATE POLICY outreach_variants_update ON public.outreach_variants
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR created_by_user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS outreach_variants_delete ON public.outreach_variants;
CREATE POLICY outreach_variants_delete ON public.outreach_variants
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR created_by_user_id = auth.uid()
  );

DROP POLICY IF EXISTS crm_outreach_events_select ON public.crm_outreach_events;
CREATE POLICY crm_outreach_events_select ON public.crm_outreach_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR public.is_sales()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.crm_companies_pipeline p
      WHERE p.id = crm_outreach_events.pipeline_card_id
        AND p.created_by_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      WHERE c.contact_id = crm_outreach_events.contact_id
        AND c.created_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS crm_outreach_events_insert ON public.crm_outreach_events;
CREATE POLICY crm_outreach_events_insert ON public.crm_outreach_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_agent_or_above()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS crm_outreach_events_update ON public.crm_outreach_events;
CREATE POLICY crm_outreach_events_update ON public.crm_outreach_events
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR user_id = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 7) Backfill events from follow_up_log and crm_outreach_logs (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO public.crm_outreach_events (
  pipeline_card_id,
  user_id,
  event_type,
  channel,
  occurred_at,
  outcome,
  notes,
  product_category
)
SELECT
  p.id,
  p.created_by_user_id,
  'touch',
  CASE
    WHEN lower(coalesce(entry->>'channel', '')) IN ('linkedin') THEN 'linkedin'
    WHEN lower(coalesce(entry->>'channel', '')) IN ('call', 'cold_call', 'phone') THEN 'cold_call'
    WHEN lower(coalesce(entry->>'channel', '')) IN ('support_email', 'support') THEN 'support_email'
    WHEN lower(coalesce(entry->>'channel', '')) IN ('instagram_dm', 'ig_dm', 'instagram') THEN 'instagram_dm'
    WHEN lower(coalesce(entry->>'channel', '')) IN ('instagram_engage') THEN 'instagram_engage'
    ELSE 'cold_email'
  END,
  COALESCE((entry->>'sent_at')::timestamptz, p.last_touch_at, p.outreach_at, p.created_at),
  NULLIF(entry->>'outcome', ''),
  'Backfilled from follow_up_log',
  c.product_category
FROM public.crm_companies_pipeline p
LEFT JOIN public.companies c ON c.company_id = p.company_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.follow_up_log, '[]'::jsonb)) AS entry
WHERE jsonb_typeof(COALESCE(p.follow_up_log, '[]'::jsonb)) = 'array'
  AND COALESCE(entry->>'sent_at', '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.crm_outreach_events e
    WHERE e.pipeline_card_id = p.id
      AND e.notes = 'Backfilled from follow_up_log'
      AND e.occurred_at = COALESCE((entry->>'sent_at')::timestamptz, p.last_touch_at, p.outreach_at, p.created_at)
  );

INSERT INTO public.crm_outreach_events (
  contact_id,
  user_id,
  event_type,
  channel,
  occurred_at,
  notes
)
SELECT
  l.contact_id,
  l.user_id,
  'touch',
  CASE
    WHEN lower(l.outreach_channel) IN ('linkedin') THEN 'linkedin'
    WHEN lower(l.outreach_channel) IN ('call', 'cold_call', 'phone') THEN 'cold_call'
    WHEN lower(l.outreach_channel) IN ('support_email', 'support') THEN 'support_email'
    WHEN lower(l.outreach_channel) IN ('instagram_dm', 'ig_dm', 'instagram') THEN 'instagram_dm'
    WHEN lower(l.outreach_channel) IN ('instagram_engage') THEN 'instagram_engage'
    WHEN lower(l.outreach_channel) IN ('email', 'cold_email') THEN 'cold_email'
    ELSE 'other'
  END,
  l.outreach_at,
  COALESCE(l.outreach_notes, 'Backfilled from crm_outreach_logs')
FROM public.crm_outreach_logs l
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_outreach_events e
  WHERE e.contact_id = l.contact_id
    AND e.occurred_at = l.outreach_at
    AND e.notes = COALESCE(l.outreach_notes, 'Backfilled from crm_outreach_logs')
);

INSERT INTO public.crm_outreach_events (
  pipeline_card_id,
  user_id,
  event_type,
  channel,
  occurred_at,
  outcome,
  notes,
  product_category
)
SELECT
  p.id,
  p.created_by_user_id,
  'response',
  'other',
  p.responded_at,
  'neutral',
  'Backfilled from responded_at',
  c.product_category
FROM public.crm_companies_pipeline p
LEFT JOIN public.companies c ON c.company_id = p.company_id
WHERE p.responded_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.crm_outreach_events e
    WHERE e.pipeline_card_id = p.id
      AND e.notes = 'Backfilled from responded_at'
  );
