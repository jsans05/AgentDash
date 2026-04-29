import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { formatContractDateForDisplay, getContractDisplayStatus } from "@/lib/contracts";
import { ArchiveContractButton } from "@/components/contracts/ArchiveContractButton";

export default async function ContractsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ athlete?: string; status?: string; category?: string; showArchived?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const showArchived = searchParams.showArchived === "1" || searchParams.showArchived === "true";
  const profile = await requireProfile();
  const supabase = await createServerClient();

  // Agents see only contracts for athletes they represent (via athlete_agents)
  let agentAthleteIds: string[] | null = null;
  if (profile.role === "agent") {
    const { data: links } = await supabase
      .from("athlete_agents")
      .select("athlete_id")
      .eq("user_id", profile.user_id);
    agentAthleteIds = links?.map((r) => r.athlete_id) ?? [];
  }

  let query = supabase
    .from("contracts")
    .select("*")
    .order("status", { ascending: false })
    .order("start_date", { ascending: false });

  if (agentAthleteIds !== null) {
    if (agentAthleteIds.length === 0) query = query.eq("athlete_id", "00000000-0000-0000-0000-000000000000");
    else query = query.in("athlete_id", agentAthleteIds);
  }

  if (!showArchived) {
    query = query.eq("archived", false);
  }
  if (searchParams.athlete) {
    query = query.eq("athlete_id", searchParams.athlete);
  }
  if (searchParams.status) {
    query = query.eq("status", searchParams.status);
  }
  if (searchParams.category) {
    query = query.ilike("category", searchParams.category);
  }

  const { data: contractsRaw } = await query;

  const contracts = contractsRaw ?? [];
  const athleteIds = [...new Set(contracts.map((c: any) => c.athlete_id).filter(Boolean))];
  const companyIds = [...new Set(contracts.map((c: any) => c.company_id).filter(Boolean))];

  const [athletesByAthleteId, athletesById, companiesRes] = await Promise.all([
    athleteIds.length > 0 ? supabase.from("athletes").select("*").in("athlete_id", athleteIds) : Promise.resolve({ data: [] }),
    athleteIds.length > 0 ? supabase.from("athletes").select("*").in("id", athleteIds) : Promise.resolve({ data: [] }),
    companyIds.length > 0 ? supabase.from("companies").select("company_id, name").in("company_id", companyIds) : Promise.resolve({ data: [] }),
  ]);

  const athletesList = (athletesByAthleteId?.data?.length ?? 0) > 0 ? (athletesByAthleteId?.data ?? []) : (athletesById?.data ?? []);
  const companiesList = companiesRes?.data ?? [];

  const athleteMap = new Map<string, { first_name?: string; last_name?: string }>();
  for (const a of athletesList) {
    const row = a as any;
    const name = { first_name: row.first_name, last_name: row.last_name };
    if (row.athlete_id) athleteMap.set(row.athlete_id, name);
    if (row.id) athleteMap.set(row.id, name);
  }
  const companyMap = new Map<string, string>();
  for (const c of companiesList) {
    companyMap.set((c as any).company_id, (c as any).name ?? "");
  }

  const contractsWithRelations = contracts.map((c: any) => ({
    ...c,
    athletes: athleteMap.get(c.athlete_id) ? { first_name: athleteMap.get(c.athlete_id)!.first_name, last_name: athleteMap.get(c.athlete_id)!.last_name } : null,
    companies: companyMap.get(c.company_id) ? { name: companyMap.get(c.company_id) } : null,
  }));

  // Get distinct categories from contracts for filter dropdown
  const distinctCategories = [...new Set(contracts.map((c: any) => c.category).filter(Boolean))].sort();

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">Contracts</h1>
          <p className="mt-2 text-sm text-[#D7D0C4]">
            {contractsWithRelations?.length ?? 0} contracts
            {!showArchived && (
              <>
                {" "}
                <Link
                  href={`/contracts?${new URLSearchParams({ ...searchParams, showArchived: "1" } as any).toString()}`}
                  className="text-[#CEE4D4] hover:text-[#E8F6ED]"
                >
                  Show archived
                </Link>
              </>
            )}
            {showArchived && (
              <>
                {" "}
                <Link
                  href={`/contracts?${new URLSearchParams(Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => k !== "showArchived" && v != null))).toString()}`}
                  className="text-[#CEE4D4] hover:text-[#E8F6ED]"
                >
                  Hide archived
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-4">
        <select
          defaultValue={searchParams.status}
          className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
        </select>
        {distinctCategories.length > 0 && (
          <select
            defaultValue={searchParams.category}
            className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          >
            <option value="">All Categories</option>
            {distinctCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="mt-8">
        <table className="min-w-full divide-y divide-white/15 rounded-xl border border-white/10 bg-[#121614]">
          <thead>
            <tr>
              <th className="py-3.5 pl-4 text-left text-sm font-semibold text-[#F4F1EB]">Athlete</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Company</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Category</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Dates</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Status</th>
              <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {contractsWithRelations?.map((contract: any) => (
              <tr key={contract.contract_id} className="hover:bg-white/5">
                <td className="py-4 pl-4 text-sm">
                  <Link
                    href={`/athlete/${contract.athlete_id}`}
                    className="text-[#CEE4D4] hover:text-[#E8F6ED]"
                  >
                    {contract.athletes?.first_name} {contract.athletes?.last_name}
                  </Link>
                </td>
                <td className="px-3 py-4 text-sm text-[#D7D0C4]">
                  {contract.companies?.name}
                </td>
                <td className="px-3 py-4 text-sm text-[#D7D0C4]">
                  {contract.category}
                </td>
                <td className="px-3 py-4 text-sm text-[#D7D0C4]">
                  {formatContractDateForDisplay(contract.start_date) ?? "—"} -{" "}
                  {formatContractDateForDisplay(contract.end_date) ?? "Ongoing"}
                </td>
                <td className="px-3 py-4">
                  {(() => {
                    const { displayStatus, expiresInMonths } = getContractDisplayStatus({
                      status: contract.status,
                      end_date: contract.end_date ?? null,
                    });
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex w-fit px-2 py-1 text-xs rounded ${
                          displayStatus === "active" ? "bg-[#1B2F21] text-[#DBEEE0] border border-[#2E7040]/60" :
                          displayStatus === "expired" ? "bg-[#2A2F2B] text-[#D7D0C4] border border-white/15" :
                          "bg-[#3A1E1E] text-[#FFD9D9] border border-[#A35A5A]/50"
                        }`}>
                          {displayStatus}
                        </span>
                        {displayStatus === "active" && expiresInMonths !== null && (
                          <span className="w-fit rounded border border-[#87652E]/60 bg-[#3A2E1A] px-2 py-0.5 text-xs text-[#F3D8A2]">
                            Expires in {expiresInMonths} {expiresInMonths === 1 ? "month" : "months"}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-3 py-4 text-sm">
                  <ArchiveContractButton
                    contractId={contract.contract_id}
                    archived={contract.archived === true}
                    label
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
