import type { SupabaseClient } from "@supabase/supabase-js";
import { getContractDisplayStatus } from "@/lib/contracts";
import { STAGES, type PipelineStage } from "@/lib/crm/pipeline-stages";
import type { Profile } from "@/lib/supabase/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReachBySportRow = {
  sport: string;
  total_followers: number;
  athlete_count: number;
};

export type AvgErBySportRow = {
  sport: string;
  avg_er_20p: number;
  athlete_count: number;
};

export type ExpiringContractRow = {
  contract_id: string;
  athlete_id: string;
  athlete_name: string;
  company_id: string | null;
  company_name: string;
  end_date: string;
  days_until_end: number;
};

export type PipelineStageCount = {
  stage: PipelineStage;
  label: string;
  count: number;
};

export type RosterIntelligence = {
  total_reach: number;
  reach_by_sport: ReachBySportRow[];
  avg_er_by_sport: AvgErBySportRow[];
  expiring_contracts: ExpiringContractRow[];
  pipeline_stage_counts: PipelineStageCount[];
};

function contractExpiresWithin90Days(contract: { status: string; end_date: string | null }): boolean {
  const { displayStatus } = getContractDisplayStatus(contract);
  if (displayStatus !== "active" || !contract.end_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(contract.end_date);
  endDate.setHours(0, 0, 0, 0);
  if (endDate < today) return false;

  const daysUntil = Math.ceil((endDate.getTime() - today.getTime()) / MS_PER_DAY);
  return daysUntil <= 90;
}

export async function getRosterIntelligence(
  supabase: SupabaseClient,
  _profile: Profile
): Promise<RosterIntelligence> {
  const [socialRes, athletesRes, contractsRes, pipelineRes] = await Promise.all([
    supabase.from("athlete_social_data").select("athlete_id, total_followers, avg_er_20p"),
    supabase.from("athletes").select("athlete_id, first_name, last_name, sport"),
    supabase
      .from("contracts")
      .select("contract_id, athlete_id, company_id, end_date, status, archived")
      .eq("archived", false),
    supabase
      .from("crm_companies_pipeline")
      .select("pipeline_stage, archived")
      .or("archived.is.null,archived.eq.false"),
  ]);

  const socialRows = socialRes.data ?? [];
  const athletes = athletesRes.data ?? [];
  const sportByAthlete = new Map(
    athletes.map((a) => [
      a.athlete_id,
      {
        sport: (a.sport?.trim() || "Unknown") as string,
        name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || "Athlete",
      },
    ])
  );

  const total_reach = socialRows.reduce((sum, row) => sum + (Number(row.total_followers) || 0), 0);

  const reachBySportMap = new Map<string, { total: number; count: number }>();
  for (const row of socialRows) {
    const sport = sportByAthlete.get(row.athlete_id)?.sport ?? "Unknown";
    const prev = reachBySportMap.get(sport) ?? { total: 0, count: 0 };
    reachBySportMap.set(sport, {
      total: prev.total + (Number(row.total_followers) || 0),
      count: prev.count + 1,
    });
  }
  const reach_by_sport = [...reachBySportMap.entries()]
    .map(([sport, v]) => ({
      sport,
      total_followers: v.total,
      athlete_count: v.count,
    }))
    .sort((a, b) => b.total_followers - a.total_followers);

  const erBySportMap = new Map<string, { sum: number; count: number }>();
  for (const row of socialRows) {
    const er = row.avg_er_20p;
    if (er == null || !Number.isFinite(Number(er))) continue;
    const sport = sportByAthlete.get(row.athlete_id)?.sport ?? "Unknown";
    const prev = erBySportMap.get(sport) ?? { sum: 0, count: 0 };
    erBySportMap.set(sport, { sum: prev.sum + Number(er), count: prev.count + 1 });
  }
  const avg_er_by_sport = [...erBySportMap.entries()]
    .map(([sport, v]) => ({
      sport,
      avg_er_20p: v.sum / v.count,
      athlete_count: v.count,
    }))
    .sort((a, b) => b.avg_er_20p - a.avg_er_20p);

  const companyIds = [
    ...new Set((contractsRes.data ?? []).map((c) => c.company_id).filter(Boolean)),
  ] as string[];
  const companiesRes =
    companyIds.length > 0
      ? await supabase.from("companies").select("company_id, name").in("company_id", companyIds)
      : { data: [] as { company_id: string; name: string }[] };
  const companyName = new Map((companiesRes.data ?? []).map((c) => [c.company_id, c.name]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiring_contracts = (contractsRes.data ?? [])
    .filter((c) => contractExpiresWithin90Days(c))
    .map((c) => {
      const endDate = new Date(c.end_date!);
      endDate.setHours(0, 0, 0, 0);
      const days_until_end = Math.ceil((endDate.getTime() - today.getTime()) / MS_PER_DAY);
      const athlete = sportByAthlete.get(c.athlete_id);
      return {
        contract_id: c.contract_id,
        athlete_id: c.athlete_id,
        athlete_name: athlete?.name ?? "Athlete",
        company_id: c.company_id,
        company_name: c.company_id ? (companyName.get(c.company_id) ?? "—") : "—",
        end_date: c.end_date!,
        days_until_end,
      };
    })
    .sort((a, b) => a.days_until_end - b.days_until_end);

  const stageCounts = new Map<PipelineStage, number>();
  for (const s of STAGES) stageCounts.set(s.id, 0);
  for (const row of pipelineRes.data ?? []) {
    const stage = row.pipeline_stage as PipelineStage;
    if (stageCounts.has(stage)) {
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
    }
  }
  const pipeline_stage_counts = STAGES.map((s) => ({
    stage: s.id,
    label: s.label,
    count: stageCounts.get(s.id) ?? 0,
  }));

  return {
    total_reach,
    reach_by_sport,
    avg_er_by_sport,
    expiring_contracts,
    pipeline_stage_counts,
  };
}
