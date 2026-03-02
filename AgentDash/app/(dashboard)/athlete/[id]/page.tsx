import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAudienceMetrics } from "@/lib/audience-metrics";
import { AthleteProfileClient } from "./client";
import { CreatorIQIdEditor } from "./ciq-editor";
import { AthleteAgentsEditor } from "./agents-editor";
import { Overview } from "@/components/overview/Overview";
import { OutreachTab } from "./outreach";
import { CoveredCategoriesSwitches } from "./CoveredCategoriesSwitches";

export default async function AthleteProfilePage({
  params,
  searchParams: searchParamsPromise,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ showArchived?: string; tab?: string }>;
}) {
  const { id } = await params;
  const searchParams = await searchParamsPromise;
  const showArchived = searchParams.showArchived === "1" || searchParams.showArchived === "true";
  const activeTab = searchParams.tab || "profile";
  const profile = await requireProfile();
  const supabase = await createServerClient();

  const { data: athlete } = await supabase
    .from("athletes")
    .select(`
      *,
      profiles:current_agent_id (
        first_name,
        last_name,
        email
      )
    `)
    .eq("athlete_id", id)
    .single();

  if (!athlete) notFound();

  // Load all agents for this athlete (many-to-many)
  const { data: athleteAgents } = await supabase
    .from("athlete_agents")
    .select(`
      user_id,
      is_primary,
      profiles:user_id (first_name, last_name, email)
    `)
    .eq("athlete_id", id)
    .order("is_primary", { ascending: false });

  // Check access: agent can view if they are in athlete_agents for this athlete
  const agentIds = (athleteAgents ?? []).map((a: any) => a.user_id);
  if (profile.role === "agent" && !agentIds.includes(profile.user_id)) {
    redirect("/unauthorized");
  }

  // Get contracts (select * then resolve names so it works without FKs)
  let contractsQuery = supabase
    .from("contracts")
    .select("*")
    .eq("athlete_id", id)
    .order("status", { ascending: false })
    .order("start_date", { ascending: false });
  if (!showArchived) {
    contractsQuery = contractsQuery.eq("archived", false);
  }
  const { data: contractsRaw } = await contractsQuery;

  const contractsList = contractsRaw ?? [];
  const companyIds = [...new Set(contractsList.map((c: any) => c.company_id).filter(Boolean))];
  const contractIds = contractsList.map((c: any) => c.contract_id);
  const [companiesRes, exclusivitiesRes] = await Promise.all([
    companyIds.length > 0 ? supabase.from("companies").select("company_id, name").in("company_id", companyIds) : Promise.resolve({ data: [] }),
    contractIds.length > 0
      ? supabase.from("contract_exclusivities").select("contract_id, taxonomy_id, sponsorship_taxonomies:taxonomy_id(category)").in("contract_id", contractIds)
      : Promise.resolve({ data: [] }),
  ]);
  const companyMap = new Map((companiesRes?.data ?? []).map((c: any) => [c.company_id, c.name]));
  const exclusivitiesByContract = new Map<string, { taxonomy_id: string; category: string }[]>();
  for (const row of exclusivitiesRes?.data ?? []) {
    const list = exclusivitiesByContract.get(row.contract_id) ?? [];
    list.push({
      taxonomy_id: row.taxonomy_id,
      category: (row.sponsorship_taxonomies as any)?.category ?? "—",
    });
    exclusivitiesByContract.set(row.contract_id, list);
  }
  const contracts = contractsList.map((c: any) => {
    const exclusivities = exclusivitiesByContract.get(c.contract_id) ?? [];
    return {
      ...c,
      companies: companyMap.get(c.company_id) ? { name: companyMap.get(c.company_id) } : null,
      category_labels: exclusivities.map((e) => e.category),
      category_taxonomy_ids: exclusivities.map((e) => e.taxonomy_id),
    };
  });

  // Get latest CIQ snapshots
  const { data: snapshots } = await supabase
    .from("creatoriq_snapshots")
    .select("*")
    .eq("athlete_id", id)
    .order("fetched_at", { ascending: false })
    .limit(10);

  const audienceMetrics = await getAudienceMetrics(supabase, id);

  // TEMP DEBUG: remove this block once matches > 0 and audience charts render correctly
  const filteredSnapshots = (snapshots || []).filter(
    (s: { snapshot_type: string }) => s.snapshot_type === "accounts" || s.snapshot_type === "audience"
  );
  for (const s of filteredSnapshots) {
    const snap = s as { snapshot_type: string; raw_json: unknown };
    console.log("[AthleteProfile] snapshot_type", snap.snapshot_type);
    console.log("[AthleteProfile] typeof raw_json", typeof snap.raw_json);
    const raw = snap.raw_json;
    if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
      console.log("[AthleteProfile] top-level keys", Object.keys(raw as Record<string, unknown>));
    }
  }
  const accSnap = filteredSnapshots.find((s: { snapshot_type: string }) => s.snapshot_type === "accounts") as { raw_json: unknown } | undefined;
  const audSnap = filteredSnapshots.find((s: { snapshot_type: string }) => s.snapshot_type === "audience") as { raw_json: unknown } | undefined;
  if (accSnap?.raw_json != null && typeof accSnap.raw_json === "object" && !Array.isArray(accSnap.raw_json)) {
    console.log("[AthleteProfile] accounts snapshot top-level keys", Object.keys(accSnap.raw_json as Record<string, unknown>));
  }
  if (audSnap?.raw_json != null && typeof audSnap.raw_json === "object" && !Array.isArray(audSnap.raw_json)) {
    console.log("[AthleteProfile] audience snapshot top-level keys", Object.keys(audSnap.raw_json as Record<string, unknown>));
  }

  const canEdit = profile.role === "admin" || (profile.role === "agent" && agentIds.includes(profile.user_id));

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/roster" className="text-sm text-blue-600 hover:text-blue-900">
          ← Back to Roster
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-5 border-b border-gray-200">
          <h1 className="text-2xl font-semibold text-gray-900">
            {athlete.first_name} {athlete.last_name}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {athlete.sport} • {[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "No location"}
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <Link
              href={`/athlete/${id}?tab=profile${showArchived ? "&showArchived=1" : ""}`}
              className={`${
                activeTab === "profile"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
            >
              Profile
            </Link>
            <Link
              href={`/athlete/${id}?tab=outreach`}
              className={`${
                activeTab === "outreach"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
            >
              Outreach
            </Link>
          </nav>
        </div>

        <div className="px-6 py-5 space-y-6">
          {activeTab === "profile" ? (
            <>
              {/* Basic Info */}
              <section>
                <h2 className="text-lg font-medium text-gray-900 mb-3">Basic Information</h2>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-gray-500">CreatorIQ Creator ID</dt>
                    <dd className="mt-1">
                      {canEdit ? (
                        <CreatorIQIdEditor athleteId={id} initialValue={athlete.creatoriq_publisher_id} />
                      ) : (
                        <span className="text-sm text-gray-900">{athlete.creatoriq_publisher_id || "—"}</span>
                      )}
                    </dd>
                  </div>
                  {profile.role !== "agent" && (
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Agents</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {profile.role === "admin" ? (
                          <AthleteAgentsEditor athleteId={id} initialAgents={athleteAgents ?? []} />
                        ) : (
                          <>
                            {athleteAgents && athleteAgents.length > 0
                              ? athleteAgents.map((a: any) => (
                                  <span key={a.user_id} className="mr-2">
                                    {a.profiles
                                      ? `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim() || a.profiles.email
                                      : a.user_id}
                                    {a.is_primary && " (primary)"}
                                  </span>
                                ))
                              : "Unassigned"}
                          </>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Overview (CreatorIQ + manual audience fallback) */}
              <Overview
                athleteId={id}
                creatoriqId={athlete.creatoriq_publisher_id}
                snapshots={(snapshots || []).filter(
                  (s: { snapshot_type: string }) =>
                    s.snapshot_type === "accounts" || s.snapshot_type === "audience"
                )}
                audienceMetrics={audienceMetrics}
                canRefresh={canEdit}
              />

              {/* Prospecting: categories marked as covered (AI won't search these) */}
              <CoveredCategoriesSwitches
                athleteId={id}
                sport={athlete.sport ?? null}
                canEdit={canEdit}
              />

              {/* Accolades */}
              <AthleteProfileClient
                athleteId={id}
                athleteSport={athlete.sport ?? null}
                initialAccolades={athlete.accolades || []}
                canEdit={canEdit}
                contracts={contracts || []}
                showArchived={showArchived}
              />
            </>
          ) : (
            <OutreachTab
              athleteId={id}
              athleteName={`${athlete.first_name} ${athlete.last_name}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
