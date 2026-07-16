import { createServerClient } from "@/lib/supabase/server";
import { mapPipelineRow } from "@/lib/crm/map-pipeline-card";
import {
  buildPipelineAnalytics,
  type PipelineAnalyticsRow,
  type PipelineAnalyticsSnapshot,
} from "@/lib/crm/pipeline-analytics";
import type { Profile } from "@/lib/supabase/types";

export const PIPELINE_ANALYTICS_SELECT =
  "id, company_id, created_by_user_id, pipeline_stage, archived, outreach_at, responded_at, follow_up_step, next_action, next_follow_up_at, last_touch_at, follow_up_log, closed_value, updated_at, created_at, companies(name, product_category, hq_phone, total_funding_printed, latest_funding_stage, headcount_twelve_month_growth, firmographics_enriched_at)";

export async function fetchPipelineAnalytics(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile
): Promise<PipelineAnalyticsSnapshot> {
  const teamScope = profile.role === "admin" || profile.role === "sales";

  let query = supabase
    .from("crm_companies_pipeline")
    .select(PIPELINE_ANALYTICS_SELECT)
    .eq("archived", false);

  if (!teamScope) {
    query = query.eq("created_by_user_id", profile.user_id);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((row) => mapPipelineRow(row as Record<string, unknown>)) as PipelineAnalyticsRow[];

  return buildPipelineAnalytics(rows, teamScope ? "team" : "mine");
}
