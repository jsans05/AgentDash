import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAthleteAudienceProfile } from "@/lib/athlete-data";
import { AthleteProfileClient } from "./client";
import { AthleteAgentsEditor } from "./agents-editor";
import { OutreachTab } from "./outreach";
import { CoveredCategoriesSwitches } from "./CoveredCategoriesSwitches";
import { SportEditor } from "./sport-editor";
import { GenderEditor } from "./gender-editor";
import type { AthleteGender } from "@/lib/athletes/gender";
import { DeleteAthletePanel } from "./delete-athlete";
import { AudiencePercentExpandable } from "@/components/athlete/AudiencePercentExpandable";
import { AudienceViewMoreSection } from "@/components/athlete/AudienceViewMoreSection";
import { GenderPie } from "@/components/athlete/GenderPie";
import { SocialPlatformMetrics } from "@/components/athlete/SocialPlatformMetrics";

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
      created_at,
      profiles:user_id (first_name, last_name, email)
    `)
    .eq("athlete_id", id)
    .order("is_primary", { ascending: false });

  // Normalize Supabase join shape: profiles:user_id(...) can come back as an array,
  // but the UI editor expects profiles as a single object (or null).
  const athleteAgentsForEditor = (athleteAgents ?? []).map((a: any) => ({
    ...a,
    profiles: Array.isArray(a.profiles) ? a.profiles[0] ?? null : a.profiles ?? null,
  }));

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

  const audienceProfile = await getAthleteAudienceProfile(supabase, id);

  const canEdit = profile.role === "admin" || (profile.role === "agent" && agentIds.includes(profile.user_id));

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/roster" className="text-sm text-[#CEE4D4] hover:text-[#E8F6ED]">
          ← Back to Roster
        </Link>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#151A17] shadow">
        <div className="border-b border-white/10 px-6 py-5">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">
            {athlete.first_name} {athlete.last_name}
          </h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            {athlete.sport} • {[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ") || "No location"}
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 px-6 py-2">
          <nav className="flex flex-wrap gap-2" aria-label="Tabs">
            <Link
              href={`/athlete/${id}?tab=profile${showArchived ? "&showArchived=1" : ""}`}
              className={`${
                activeTab === "profile"
                  ? "border-[#2E7040]/70 bg-[#2E7040] text-[#F2FFF5]"
                  : "border-transparent text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
              } whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium transition-colors`}
            >
              Profile
            </Link>
            <Link
              href={`/athlete/${id}?tab=outreach`}
              className={`${
                activeTab === "outreach"
                  ? "border-[#2E7040]/70 bg-[#2E7040] text-[#F2FFF5]"
                  : "border-transparent text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
              } whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium transition-colors`}
            >
              Outreach
            </Link>
          </nav>
        </div>

        <div className={activeTab === "outreach" ? "flex h-[calc(100dvh-15rem)] min-h-[28rem] flex-col overflow-hidden px-6 py-4" : "space-y-6 px-6 py-5"}>
          {activeTab === "profile" ? (
            <>
              {/* Basic Info */}
              <section>
                <h2 className="mb-3 text-lg font-medium text-[#F4F1EB]">Basic Information</h2>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm font-medium text-[#B9B2A6]">Agents</dt>
                    <dd className="mt-1 text-sm text-[#ECE7DF]">
                      {profile.role === "admin" ? (
                        <AthleteAgentsEditor athleteId={id} initialAgents={athleteAgentsForEditor as any} />
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
                  <SportEditor
                    athleteId={id}
                    initialSport={athlete.sport ?? null}
                    canEdit={canEdit}
                  />
                  <GenderEditor
                    athleteId={id}
                    initialGender={(athlete.gender as AthleteGender | null) ?? null}
                    canEdit={canEdit}
                  />
                </dl>
              </section>

              {/* About & Accolades */}
              <AthleteProfileClient
                athleteId={id}
                athleteSport={athlete.sport ?? null}
                initialAccolades={athlete.accolades || []}
                initialAbout={athlete.about ?? ""}
                canEdit={canEdit}
                contracts={[]}
                sectionMode="accolades"
              />

              <section>
                <h2 className="mb-3 text-lg font-medium text-[#F4F1EB]">Social & Audience</h2>
                <SocialPlatformMetrics social={audienceProfile.social} />
                <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-medium text-[#D7D0C4]">Gender</h3>
                    <GenderPie
                      rows={audienceProfile.gender.map((r) => ({
                        name: r.audience_name,
                        ig_audience_percent: r.ig_audience_percent,
                        ig_audience_count: r.ig_audience_count,
                      }))}
                      emptyText="No gender data."
                    />
                  </div>
                  <div aria-hidden />
                  <div>
                    <h3 className="text-sm font-medium text-[#D7D0C4]">Age</h3>
                    <AudiencePercentExpandable
                      rows={[...audienceProfile.age]
                        .sort((a, b) => {
                          const ageSortKey = (name: string) => {
                            const n = parseInt(name.match(/\d+/)?.[0] ?? "0", 10);
                            const trimmed = name.trim();
                            if (/^</.test(trimmed) || /^under\b/i.test(trimmed)) return n - 1000;
                            return n;
                          };
                          return ageSortKey(a.audience_name) - ageSortKey(b.audience_name);
                        })
                        .map((r) => ({
                          name: r.audience_name,
                          ig_audience_percent: r.ig_audience_percent,
                          ig_audience_count: r.ig_audience_count,
                        }))}
                      countInLabel
                      previewLimit={Math.max(1, audienceProfile.age.length)}
                      emptyText="No age data."
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[#D7D0C4]">Top Countries</h3>
                    <AudiencePercentExpandable
                      rows={audienceProfile.countries.map((r) => ({
                        name: r.audience_name,
                        ig_audience_percent: r.ig_audience_percent,
                        ig_audience_count: r.ig_audience_count,
                      }))}
                      countInLabel
                      previewLimit={5}
                      emptyText="No country data."
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[#D7D0C4]">Top Interests</h3>
                    <AudiencePercentExpandable
                      rows={audienceProfile.interests.map((r) => ({
                        name: r.audience_name,
                        ig_audience_percent: r.ig_audience_percent,
                        ig_audience_count: r.ig_audience_count,
                      }))}
                      countInLabel
                      previewLimit={5}
                      emptyText="No interest data."
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[#D7D0C4]">Top Brand Affinities</h3>
                    <AudiencePercentExpandable
                      rows={audienceProfile.brands.map((r) => ({
                        name: r.audience_name,
                        ig_audience_percent: r.ig_audience_percent,
                        ig_audience_count: r.ig_audience_count,
                      }))}
                      countInLabel
                      previewLimit={5}
                      emptyText="No brand data."
                    />
                  </div>
                </div>
                <AudienceViewMoreSection
                  states={audienceProfile.states}
                  cities={audienceProfile.cities}
                  ethnicity={audienceProfile.ethnicity}
                />
              </section>

              {/* Prospecting: categories marked as covered (AI won't search these) */}
              <CoveredCategoriesSwitches
                athleteId={id}
                sport={athlete.sport ?? null}
                canEdit={canEdit}
              />

              {/* Notes and contracts */}
              <AthleteProfileClient
                athleteId={id}
                athleteSport={athlete.sport ?? null}
                initialAccolades={athlete.accolades || []}
                initialNotes={athlete.notes ?? ""}
                canEdit={canEdit}
                contracts={contracts || []}
                showArchived={showArchived}
                sectionMode="notes-contracts"
              />

              {profile.role === "admin" && (
                <DeleteAthletePanel
                  athleteId={id}
                  athleteName={
                    [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() ||
                    "Athlete"
                  }
                  contractCount={contracts?.length ?? 0}
                />
              )}
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
