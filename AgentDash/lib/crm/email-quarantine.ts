import { normalizePipelineContacts } from "@/lib/crm/pipeline-contacts";

export function normalizeEmailForSuppression(email: string): string {
  return email.trim().toLowerCase();
}

export function primaryPipelineContactEmail(pipelineContacts: unknown): string | null {
  const slots = normalizePipelineContacts(pipelineContacts);
  for (const slot of slots) {
    const email = String(slot.email ?? "").trim();
    if (email) return email;
  }
  return null;
}

export type QuarantineEmailParams = {
  supabaseAdmin: {
    from: (table: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string }
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  email: string;
  reason: string;
  userId: string;
  companyId?: string | null;
  contactId?: string | null;
  pipelineId?: string | null;
};

export async function quarantineEmail(params: QuarantineEmailParams): Promise<void> {
  const normalized = normalizeEmailForSuppression(params.email);
  if (!normalized) return;

  const { error } = await params.supabaseAdmin.from("crm_email_suppressions").upsert(
    {
      email_normalized: normalized,
      reason: params.reason,
      company_id: params.companyId ?? null,
      contact_id: params.contactId ?? null,
      pipeline_id: params.pipelineId ?? null,
      created_by_user_id: params.userId,
    },
    { onConflict: "email_normalized,created_by_user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function isEmailSuppressed(
  supabase: { from: (table: string) => any },
  userId: string,
  email: string
): Promise<boolean> {
  const normalized = normalizeEmailForSuppression(email);
  if (!normalized) return false;
  const { data } = await supabase
    .from("crm_email_suppressions")
    .select("id")
    .eq("created_by_user_id", userId)
    .eq("email_normalized", normalized)
    .maybeSingle();
  return !!data;
}
