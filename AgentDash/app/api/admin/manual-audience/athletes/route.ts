import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  await requireRole("admin");
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name")
    .order("last_name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const list = (data ?? []).map((a) => ({
    athlete_id: a.athlete_id,
    label: [a.last_name, a.first_name].filter(Boolean).join(", ") || a.athlete_id,
  }));
  return NextResponse.json({ athletes: list });
}
