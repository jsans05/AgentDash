import { NextResponse } from "next/server";
import { z } from "zod";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

const toneRowSchema = z.object({
  sample_index: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sample_title: z.string().trim().max(200).optional().nullable(),
  sample_content: z.string().trim().min(20).max(20000),
});

const putSchema = z.object({
  samples: z.array(toneRowSchema).max(3),
});

export async function GET() {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("ai_email_tone_samples")
    .select("sample_id, sample_index, sample_title, sample_content, created_at, updated_at")
    .eq("owner_user_id", profile.user_id)
    .order("sample_index", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ samples: data ?? [] });
}

export async function PUT(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const raw = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const dedupe = new Set<number>();
  for (const row of parsed.data.samples) {
    if (dedupe.has(row.sample_index)) {
      return NextResponse.json({ error: "sample_index values must be unique" }, { status: 400 });
    }
    dedupe.add(row.sample_index);
  }

  const { error: deleteError } = await supabase
    .from("ai_email_tone_samples")
    .delete()
    .eq("owner_user_id", profile.user_id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  if (parsed.data.samples.length > 0) {
    const payload = parsed.data.samples.map((row) => ({
      owner_user_id: profile.user_id,
      sample_index: row.sample_index,
      sample_title: row.sample_title?.trim() || null,
      sample_content: row.sample_content.trim(),
    }));
    const { error: insertError } = await supabase.from("ai_email_tone_samples").insert(payload);
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("ai_email_tone_samples")
    .select("sample_id, sample_index, sample_title, sample_content, created_at, updated_at")
    .eq("owner_user_id", profile.user_id)
    .order("sample_index", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, samples: data ?? [] });
}
