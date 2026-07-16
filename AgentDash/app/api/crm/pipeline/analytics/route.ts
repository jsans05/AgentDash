import { requireNonAccounting } from "@/lib/auth";
import { fetchPipelineAnalytics } from "@/lib/crm/pipeline-analytics-server";
import { createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const profile = await requireNonAccounting();
    const supabase = await createServerClient();
    const snapshot = await fetchPipelineAnalytics(supabase, profile);
    return NextResponse.json({ analytics: snapshot });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load analytics";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
