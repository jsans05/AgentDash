import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  dedupeAgencyActivity,
  isEmptyAgencyActivity,
  type CompanyAgencyActivity,
} from "@/lib/crm/company-agency-activity";

const OUTREACH_PIPELINE_STAGES = new Set(["outreach", "follow_up", "in_progress", "closed"]);

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatAgentName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!profile) return "Unknown agent";
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name || String(profile.email ?? "").trim() || "Unknown agent";
}

function athleteNamesFromPotentialAthletes(potentialAthletes: unknown): string[] {
  const arr = Array.isArray(potentialAthletes) ? potentialAthletes : [];
  const names = arr
    .map((p) => String((p as { name?: unknown })?.name ?? "").trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function hasTargetListAthletes(potentialAthletes: unknown): boolean {
  return athleteNamesFromPotentialAthletes(potentialAthletes).length > 0;
}

function emptyActivityForCompanies(companyIds: string[]): Map<string, CompanyAgencyActivity> {
  const map = new Map<string, CompanyAgencyActivity>();
  for (const id of companyIds) {
    map.set(id, { on_other_target_lists: [], contacted_by_others: [] });
  }
  return map;
}

function addPipelineRowToActivity(
  activity: CompanyAgencyActivity,
  row: {
    created_by_user_id: string;
    pipeline_stage: string | null;
    potential_athletes: unknown;
    outreach_at: string | null;
    sent_at: string | null;
    profiles: unknown;
  }
): void {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const agentName = formatAgentName(profile as Parameters<typeof formatAgentName>[0]);
  const agentUserId = String(row.created_by_user_id);

  if (hasTargetListAthletes(row.potential_athletes)) {
    activity.on_other_target_lists.push({
      agent_user_id: agentUserId,
      agent_name: agentName,
      pipeline_stage: row.pipeline_stage ?? null,
      athlete_names: athleteNamesFromPotentialAthletes(row.potential_athletes),
    });
  }

  const stage = String(row.pipeline_stage ?? "");
  const outreachAt = row.sent_at ?? row.outreach_at;
  if (OUTREACH_PIPELINE_STAGES.has(stage) && outreachAt) {
    activity.contacted_by_others.push({
      agent_user_id: agentUserId,
      agent_name: agentName,
      last_outreach_at: outreachAt,
      outreach_channel: "pipeline",
    });
  }
}

export async function fetchAgencyActivityForCompanies(
  supabaseAdmin: SupabaseClient,
  companyIds: string[],
  viewerUserId: string
): Promise<Map<string, CompanyAgencyActivity>> {
  const uniqueIds = [...new Set(companyIds.map(String).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const result = emptyActivityForCompanies(uniqueIds);

  for (const chunk of chunkArray(uniqueIds, 200)) {
    const { data: pipelineRows, error: pipelineErr } = await supabaseAdmin
      .from("crm_companies_pipeline")
      .select(
        `
          company_id,
          created_by_user_id,
          pipeline_stage,
          potential_athletes,
          outreach_at,
          sent_at,
          profiles:created_by_user_id(first_name, last_name, email)
        `
      )
      .in("company_id", chunk)
      .neq("created_by_user_id", viewerUserId)
      .eq("archived", false);
    if (pipelineErr) throw new Error(pipelineErr.message);

    for (const row of pipelineRows ?? []) {
      const companyId = String((row as { company_id?: string }).company_id ?? "");
      const activity = result.get(companyId);
      if (!activity) continue;
      addPipelineRowToActivity(activity, row as Parameters<typeof addPipelineRowToActivity>[1]);
    }

    const { data: contactRows, error: contactErr } = await supabaseAdmin
      .from("crm_contacts")
      .select("contact_id, company_id")
      .in("company_id", chunk)
      .eq("archived", false);
    if (contactErr) throw new Error(contactErr.message);

    const contactToCompany = new Map<string, string>();
    for (const c of contactRows ?? []) {
      contactToCompany.set(String(c.contact_id), String(c.company_id));
    }
    const contactIds = [...contactToCompany.keys()];
    if (contactIds.length === 0) continue;

    for (const contactChunk of chunkArray(contactIds, 200)) {
      const { data: logRows, error: logErr } = await supabaseAdmin
        .from("crm_outreach_logs")
        .select(
          `
            user_id,
            contact_id,
            outreach_at,
            outreach_channel,
            profiles:user_id(first_name, last_name, email)
          `
        )
        .in("contact_id", contactChunk)
        .neq("user_id", viewerUserId);
      if (logErr) throw new Error(logErr.message);

      for (const log of logRows ?? []) {
        const companyId = contactToCompany.get(String(log.contact_id));
        if (!companyId) continue;
        const activity = result.get(companyId);
        if (!activity) continue;
        const profile = Array.isArray(log.profiles) ? log.profiles[0] : log.profiles;
        activity.contacted_by_others.push({
          agent_user_id: String(log.user_id),
          agent_name: formatAgentName(profile as Parameters<typeof formatAgentName>[0]),
          last_outreach_at: log.outreach_at ?? null,
          outreach_channel: log.outreach_channel ?? null,
        });
      }
    }
  }

  for (const [companyId, activity] of result) {
    result.set(companyId, dedupeAgencyActivity(activity));
  }
  return result;
}

export async function enrichTargetListRowsWithAgencyActivity<T extends { company_id: string }>(
  rows: T[],
  viewerUserId: string
): Promise<(T & { agency_activity: CompanyAgencyActivity | null })[]> {
  if (rows.length === 0) return [];
  const supabaseAdmin = await createServiceRoleClient();
  const activityMap = await fetchAgencyActivityForCompanies(
    supabaseAdmin,
    rows.map((r) => r.company_id),
    viewerUserId
  );
  return rows.map((row) => {
    const raw = activityMap.get(row.company_id) ?? null;
    const agency_activity = isEmptyAgencyActivity(raw) ? null : raw;
    return { ...row, agency_activity };
  });
}
