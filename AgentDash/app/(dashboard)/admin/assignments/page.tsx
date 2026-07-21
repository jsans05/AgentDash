import { requireRole } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AssignmentsClient } from "./client";
import type { AssignmentCard, TeammateAssignments } from "./types";
import type { PotentialAthleteEntry } from "@/lib/crm/potential-athletes";
import { STAGE_LABEL, type PipelineStage } from "@/lib/crm/pipeline-stages";

function formatName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!profile) return "Unknown";
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
  return name || String(profile.email ?? "").trim() || "Unknown";
}

export default async function AdminAssignmentsPage() {
  await requireRole("admin");
  const supabase = await createServiceRoleClient();

  const { data: pipelineRows, error } = await supabase
    .from("crm_companies_pipeline")
    .select(
      `
        id,
        company_id,
        created_by_user_id,
        assigned_by_user_id,
        assigned_at,
        pipeline_stage,
        potential_athletes,
        updated_at,
        companies(name),
        owner:created_by_user_id(first_name, last_name, email, role),
        assigner:assigned_by_user_id(first_name, last_name, email)
      `
    )
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  if (error) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Assignments</h1>
        <p className="mt-2 text-sm text-[#F1A2A2]">Failed to load: {error.message}</p>
      </div>
    );
  }

  const byOwner = new Map<string, TeammateAssignments>();

  for (const row of pipelineRows ?? []) {
    const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
    const assigner = Array.isArray(row.assigner) ? row.assigner[0] : row.assigner;
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    const ownerId = String(row.created_by_user_id);
    const ownerRole = String((owner as { role?: string } | null)?.role ?? "agent");

    if (!byOwner.has(ownerId)) {
      byOwner.set(ownerId, {
        user_id: ownerId,
        name: formatName(owner as Parameters<typeof formatName>[0]),
        email: (owner as { email?: string | null } | null)?.email ?? null,
        role: ownerRole,
        cards: [],
        stage_counts: {},
      });
    }

    const group = byOwner.get(ownerId)!;
    const stage = String(row.pipeline_stage ?? "target");
    group.stage_counts[stage] = (group.stage_counts[stage] ?? 0) + 1;

    const athletesRaw = Array.isArray(row.potential_athletes) ? row.potential_athletes : [];
    const athletes = athletesRaw
      .map((p) => {
        const e = p as PotentialAthleteEntry;
        const id = String(e?.athlete_id ?? "").trim();
        const name = String(e?.name ?? "").trim();
        if (!id || !name) return null;
        return { athlete_id: id, name };
      })
      .filter(Boolean) as { athlete_id: string; name: string }[];

    group.cards.push({
      pipeline_id: String(row.id),
      company_id: String(row.company_id),
      company_name: String((company as { name?: string } | null)?.name ?? "Unknown company"),
      pipeline_stage: stage,
      stage_label: STAGE_LABEL[stage as PipelineStage] ?? stage,
      athletes,
      assigned_by_name: row.assigned_by_user_id
        ? formatName(assigner as Parameters<typeof formatName>[0])
        : null,
      assigned_at: row.assigned_at ? String(row.assigned_at) : null,
      updated_at: String(row.updated_at),
    });
  }

  const teammates = [...byOwner.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  const allAthletes = new Map<string, string>();
  for (const t of teammates) {
    for (const c of t.cards) {
      for (const a of c.athletes) {
        allAthletes.set(a.athlete_id, a.name);
      }
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-[#F4F1EB]">Assignments</h1>
      </div>
      <p className="mt-1 text-sm text-[#B9B2A6]">
        Pipeline brands owned by each sales person and agent. Read-only — reassign from the target
        list or pipeline.
      </p>
      <AssignmentsClient
        teammates={teammates}
        athletes={[...allAthletes.entries()]
          .map(([athlete_id, name]) => ({ athlete_id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))}
      />
    </div>
  );
}
