import type { EmailTemplateMode, EmailTemplateRecord } from "@/lib/ai/email-generation";

type SupabaseLikeClient = {
  from: (table: string) => {
    select: (columns: string) => any;
    upsert: (values: Record<string, unknown> | Array<Record<string, unknown>>, options?: Record<string, unknown>) => any;
    eq: (column: string, value: unknown) => any;
    order: (column: string, options?: Record<string, unknown>) => any;
    limit: (count: number) => any;
  };
};

type DbTemplateRow = {
  mode: EmailTemplateMode;
  subject_template: string;
  body_template: string;
  is_active: boolean;
};

export async function getActiveEmailTemplate(
  supabase: SupabaseLikeClient,
  mode: EmailTemplateMode
): Promise<EmailTemplateRecord | null> {
  const { data, error } = await supabase
    .from("ai_email_templates")
    .select("mode, subject_template, body_template, is_active")
    .eq("mode", mode)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    return null;
  }
  const row = Array.isArray(data) ? (data[0] as DbTemplateRow | undefined) : null;
  if (!row || !row.is_active) return null;
  return {
    mode: row.mode,
    subject_template: String(row.subject_template ?? ""),
    body_template: String(row.body_template ?? ""),
  };
}

export async function listEmailTemplates(supabase: SupabaseLikeClient): Promise<DbTemplateRow[]> {
  const { data, error } = await supabase
    .from("ai_email_templates")
    .select("mode, subject_template, body_template, is_active")
    .order("mode", { ascending: true });
  if (error) return [];
  return Array.isArray(data) ? (data as DbTemplateRow[]) : [];
}

export async function upsertEmailTemplates(params: {
  supabase: SupabaseLikeClient;
  rows: Array<{
    mode: EmailTemplateMode;
    subject_template: string;
    body_template: string;
    is_active?: boolean;
    updated_by_user_id: string;
  }>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.rows.length) return { ok: true };
  const payload = params.rows.map((row) => ({
    mode: row.mode,
    subject_template: row.subject_template,
    body_template: row.body_template,
    is_active: row.is_active ?? true,
    updated_by_user_id: row.updated_by_user_id,
    created_by_user_id: row.updated_by_user_id,
  }));
  const { error } = await params.supabase
    .from("ai_email_templates")
    .upsert(payload, { onConflict: "mode" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
