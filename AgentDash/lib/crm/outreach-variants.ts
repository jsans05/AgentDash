import type { OutreachChannel } from "@/lib/crm/outreach-sequence";

export type OutreachVariant = {
  id: string;
  created_by_user_id: string;
  variant_label: string;
  name: string | null;
  channel: OutreachChannel;
  sequence_step_id: string | null;
  subject: string | null;
  body: string;
  is_active: boolean;
  archived: boolean;
  created_at?: string;
  updated_at?: string;
  send_count?: number;
};

/**
 * Round-robin: pick the active variant with the fewest sends for this channel.
 * Optionally prefer variants pinned to a sequence step when present.
 */
export function pickRoundRobinVariant(
  variants: OutreachVariant[],
  channel: OutreachChannel,
  opts?: { sequenceStepId?: string | null; sendCounts?: Record<string, number> }
): OutreachVariant | null {
  const active = variants.filter(
    (v) =>
      v.channel === channel &&
      v.is_active &&
      !v.archived &&
      (v.body?.trim() || v.subject?.trim())
  );
  if (active.length === 0) return null;

  const stepId = opts?.sequenceStepId ?? null;
  const pinned = stepId
    ? active.filter((v) => v.sequence_step_id === stepId)
    : [];
  const pool = pinned.length > 0 ? pinned : active.filter((v) => !v.sequence_step_id);

  const candidates = pool.length > 0 ? pool : active;
  const counts = opts?.sendCounts ?? {};

  let best: OutreachVariant | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const v of candidates) {
    const n = counts[v.id] ?? v.send_count ?? 0;
    if (n < bestCount) {
      best = v;
      bestCount = n;
    } else if (n === bestCount && best && v.variant_label < best.variant_label) {
      best = v;
    }
  }
  return best;
}

export const VARIANT_LABELS = ["A", "B", "C", "D", "E"] as const;

export const LOW_SAMPLE_THRESHOLD = 50;
