export type PipelineDraftMessageBase = {
  label?: string;
  subject?: string;
  body: string;
  created_at: string;
  athlete_id?: string | null;
};

export type PipelineDraftMessageWithSent = PipelineDraftMessageBase & {
  sent_at?: string | null;
};

export function markDraftSent<T extends PipelineDraftMessageWithSent>(
  drafts: T[],
  createdAt: string
): T[] {
  const key = String(createdAt).trim();
  if (!key) return drafts;
  const now = new Date().toISOString();
  return drafts.map((d) =>
    String(d.created_at) === key && !d.sent_at ? { ...d, sent_at: now } : d
  );
}

/** Mark the most recent batch of drafts that share the same created_at and have no sent_at. */
export function markLatestUnsentDraftsSent<T extends PipelineDraftMessageWithSent>(
  drafts: T[]
): T[] {
  if (!drafts.length) return drafts;
  const unsent = drafts.filter((d) => !d.sent_at);
  if (!unsent.length) return drafts;
  const latestCreatedAt = unsent.reduce((max, d) => {
    const t = new Date(d.created_at).getTime();
    return t > max ? t : max;
  }, 0);
  const latestKey = unsent.find((d) => new Date(d.created_at).getTime() === latestCreatedAt)?.created_at;
  if (!latestKey) return drafts;
  return markDraftSent(drafts, latestKey);
}

/** When the client PATCHes draft_messages, keep sent_at from the DB if the payload omits it. */
export function mergeDraftMessagesPreservingSentAt(
  prev: unknown,
  next: unknown
): PipelineDraftMessageWithSent[] {
  const prevList = Array.isArray(prev) ? (prev as PipelineDraftMessageWithSent[]) : [];
  const nextList = Array.isArray(next) ? (next as PipelineDraftMessageWithSent[]) : [];
  const sentByCreatedAt = new Map<string, string | null | undefined>();
  for (const d of prevList) {
    if (d?.created_at && d.sent_at) sentByCreatedAt.set(String(d.created_at), d.sent_at);
  }
  return nextList.map((d) => {
    if (!d || typeof d !== "object") return d;
    const created = String((d as PipelineDraftMessageWithSent).created_at ?? "");
    const preserved = created ? sentByCreatedAt.get(created) : undefined;
    if (preserved && !(d as PipelineDraftMessageWithSent).sent_at) {
      return { ...d, sent_at: preserved };
    }
    return d;
  });
}
