export type ContactEmailDraft = {
  label?: string;
  subject?: string;
  body: string;
  created_at: string;
  athlete_id?: string | null;
};

export type ContactOutreachDraft = {
  subject: string | null;
  body: string | null;
};

function normalizeDrafts(input: unknown): ContactEmailDraft[] {
  if (!Array.isArray(input)) return [];
  const out: ContactEmailDraft[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const body = o.body != null ? String(o.body) : "";
    if (!body.trim()) continue;
    const created_at =
      o.created_at != null && String(o.created_at).trim()
        ? String(o.created_at)
        : new Date().toISOString();
    out.push({
      body,
      created_at,
      label: o.label != null && String(o.label).trim() ? String(o.label).trim() : undefined,
      subject: o.subject != null && String(o.subject).trim() ? String(o.subject).trim() : undefined,
      athlete_id: o.athlete_id != null && String(o.athlete_id).trim() ? String(o.athlete_id).trim() : null,
    });
  }
  return out;
}

/** Latest target-list outreach draft for this athlete on a contact. */
export function pickContactOutreachDraft(
  emailDrafts: unknown,
  athleteId: string
): ContactOutreachDraft | null {
  const athleteKey = String(athleteId ?? "").trim();
  if (!athleteKey) return null;
  const drafts = normalizeDrafts(emailDrafts).filter((d) => String(d.athlete_id ?? "") === athleteKey);
  if (drafts.length === 0) return null;
  drafts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const latest = drafts[0];
  return {
    subject: latest.subject ?? null,
    body: latest.body ?? null,
  };
}

/** Replace prior drafts for the same athlete_id; append one canonical target-list draft. */
export function upsertContactOutreachDraft(
  emailDrafts: unknown,
  athleteId: string,
  subject: string,
  body: string
): ContactEmailDraft[] {
  const athleteKey = String(athleteId ?? "").trim();
  const existing = normalizeDrafts(emailDrafts).filter((d) => String(d.athlete_id ?? "") !== athleteKey);
  const entry: ContactEmailDraft = {
    label: "target-list",
    subject: subject.trim() || undefined,
    body: body.trim(),
    created_at: new Date().toISOString(),
    athlete_id: athleteKey || null,
  };
  return [...existing, entry];
}
