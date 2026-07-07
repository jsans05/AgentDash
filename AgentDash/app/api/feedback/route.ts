import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const body = await req.json().catch(() => ({}));
  const feedback = String(body.feedback ?? "").trim();

  if (!feedback) {
    return NextResponse.json({ error: "feedback required" }, { status: 400 });
  }
  if (feedback.length > 2000) {
    return NextResponse.json({ error: "feedback too long" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { error } = await supabase.from("user_feedback").insert({
    user_id: profile.user_id,
    feedback_text: feedback,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
