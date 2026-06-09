import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { listEmailTemplates, upsertEmailTemplates } from "@/lib/ai/email-template-store";

const bodySchema = z.object({
  templates: z.array(
    z.object({
      mode: z.enum(["one_to_one", "general_high_level", "general_athlete_led", "multi_athlete"]),
      subject_template: z.string().trim().min(1),
      body_template: z.string().trim().min(1),
      is_active: z.boolean().optional(),
    })
  ),
});

export async function GET() {
  await requireRole("admin");
  const supabase = await createServerClient();
  const templates = await listEmailTemplates(supabase as any);
  return NextResponse.json({ templates });
}

export async function PUT(req: Request) {
  const profile = await requireRole("admin");
  const supabase = await createServerClient();
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await upsertEmailTemplates({
    supabase: supabase as any,
    rows: parsed.data.templates.map((row) => ({
      ...row,
      updated_by_user_id: profile.user_id,
    })),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to save templates" }, { status: 500 });
  }

  const templates = await listEmailTemplates(supabase as any);
  return NextResponse.json({ ok: true, templates });
}
