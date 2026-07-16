import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildCadenceDueUpdates } from "@/lib/crm/pipeline-cadence-server";
import { normalizeFollowUpLog } from "@/lib/crm/pipeline-cadence";
import { normalizePipelineStage, pipelineStageToFunnel } from "@/lib/crm/stage-map";
import { NextResponse } from "next/server";

function authorizeCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceRoleClient();
  const { data: rows, error } = await supabase
    .from("crm_companies_pipeline")
    .select(
      "id, pipeline_stage, outreach_at, responded_at, follow_up_step, last_touch_at, next_follow_up_at, next_action, follow_up_log"
    )
    .eq("archived", false)
    .in("pipeline_stage", ["outreach", "follow_up", "ghost"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const card = {
      pipeline_stage: normalizePipelineStage(row.pipeline_stage),
      outreach_at: row.outreach_at != null ? String(row.outreach_at) : null,
      responded_at: row.responded_at != null ? String(row.responded_at) : null,
      follow_up_step: Number(row.follow_up_step ?? 0),
      last_touch_at: row.last_touch_at != null ? String(row.last_touch_at) : null,
      next_follow_up_at: row.next_follow_up_at != null ? String(row.next_follow_up_at) : null,
      next_action: row.next_action as "email" | "linkedin" | "call" | "cool" | null,
      follow_up_log: normalizeFollowUpLog(row.follow_up_log),
    };

    const patch = buildCadenceDueUpdates(card);
    if (!patch || Object.keys(patch).length === 0) continue;

    const { error: upErr } = await supabase.from("crm_companies_pipeline").update(patch).eq("id", row.id);
    if (!upErr) updated += 1;
  }

  return NextResponse.json({ ok: true, processed: (rows ?? []).length, updated });
}

export async function POST(req: Request) {
  return GET(req);
}
