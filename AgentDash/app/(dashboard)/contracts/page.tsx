import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { formatContractDateForDisplay, getContractDisplayStatus } from "@/lib/contracts";
import { ArchiveContractButton } from "@/components/contracts/ArchiveContractButton";

type SortKey = "athlete" | "company" | "category" | "dates" | "status";
const SORT_KEYS: SortKey[] = ["athlete", "company", "category", "dates", "status"];

export default async function ContractsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{
    athlete?: string;
    athleteName?: string;
    company?: string;
    status?: string;
    category?: string;
    dates?: string;
    showArchived?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const searchParams = await searchParamsPromise;
  const showArchived = searchParams.showArchived === "1" || searchParams.showArchived === "true";
  const sort: SortKey | null = SORT_KEYS.includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey)
    : null;
  const dir: "asc" | "desc" = searchParams.dir === "desc" ? "desc" : "asc";
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
    .select("contract_id, athlete_id, company_id, category, start_date, end_date, status, archived")
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

  const [athletesRes, companiesRes] = await Promise.all([
    athleteIds.length > 0
      ? supabase.from("athletes").select("athlete_id, first_name, last_name").in("athlete_id", athleteIds)
      : Promise.resolve({ data: [] }),
    companyIds.length > 0 ? supabase.from("companies").select("company_id, name").in("company_id", companyIds) : Promise.resolve({ data: [] }),
  ]);

  const athletesList = athletesRes?.data ?? [];
  const companiesList = companiesRes?.data ?? [];

  const athleteMap = new Map<string, { first_name?: string; last_name?: string }>();
  for (const a of athletesList) {
    const row = a as any;
    if (row.athlete_id) athleteMap.set(row.athlete_id, { first_name: row.first_name, last_name: row.last_name });
  }
  const companyMap = new Map<string, string>();
  for (const c of companiesList) {
    companyMap.set((c as any).company_id, (c as any).name ?? "");
  }

  const athleteFullName = (c: any) =>
    `${c.athletes?.first_name ?? ""} ${c.athletes?.last_name ?? ""}`.trim();

  let contractsWithRelations = contracts.map((c: any) => ({
    ...c,
    athletes: athleteMap.get(c.athlete_id) ? { first_name: athleteMap.get(c.athlete_id)!.first_name, last_name: athleteMap.get(c.athlete_id)!.last_name } : null,
    companies: companyMap.get(c.company_id) ? { name: companyMap.get(c.company_id) } : null,
  }));

  // Get distinct categories from contracts for filter dropdown (before name/date filters narrow the set)
  const distinctCategories = [...new Set(contracts.map((c: any) => c.category).filter(Boolean))].sort();

  // In-memory filters for fields resolved after the join (names) or derived (date state)
  if (searchParams.athleteName) {
    const needle = searchParams.athleteName.toLowerCase();
    contractsWithRelations = contractsWithRelations.filter((c: any) =>
      athleteFullName(c).toLowerCase().includes(needle)
    );
  }
  if (searchParams.company) {
    const needle = searchParams.company.toLowerCase();
    contractsWithRelations = contractsWithRelations.filter((c: any) =>
      (c.companies?.name ?? "").toLowerCase().includes(needle)
    );
  }
  if (searchParams.dates === "ongoing") {
    contractsWithRelations = contractsWithRelations.filter((c: any) => !c.end_date);
  } else if (searchParams.dates === "ended") {
    contractsWithRelations = contractsWithRelations.filter((c: any) => !!c.end_date);
  }

  // Sorting: header-driven overrides the default status/start_date ordering from the query
  if (sort) {
    const mul = dir === "desc" ? -1 : 1;
    const valueFor = (c: any): string => {
      switch (sort) {
        case "athlete":
          return athleteFullName(c).toLowerCase();
        case "company":
          return (c.companies?.name ?? "").toLowerCase();
        case "category":
          return (c.category ?? "").toLowerCase();
        case "dates":
          return c.start_date ?? "";
        case "status":
          return c.status ?? "";
      }
    };
    contractsWithRelations = [...contractsWithRelations].sort(
      (a: any, b: any) => valueFor(a).localeCompare(valueFor(b)) * mul
    );
  }

  // Build a query string from the current params, applying overrides (drop keys set to undefined/empty)
  const buildQuery = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = { ...searchParams, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== "") params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/contracts?${qs}` : "/contracts";
  };

  const sortHeaders: { key: SortKey; label: string }[] = [
    { key: "athlete", label: "Athlete" },
    { key: "company", label: "Company" },
    { key: "category", label: "Category" },
    { key: "dates", label: "Dates" },
    { key: "status", label: "Status" },
  ];
  const sortHref = (key: SortKey) =>
    buildQuery({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc" });
  const sortIndicator = (key: SortKey) => (sort === key ? (dir === "asc" ? "▲" : "▼") : "↕");

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
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        {/* Preserve non-filter state across submissions */}
        {searchParams.athlete && <input type="hidden" name="athlete" value={searchParams.athlete} />}
        {showArchived && <input type="hidden" name="showArchived" value="1" />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {sort && <input type="hidden" name="dir" value={dir} />}

        <label className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
          Athlete
          <input
            type="text"
            name="athleteName"
            defaultValue={searchParams.athleteName ?? ""}
            placeholder="Search name…"
            className="w-44 rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
          Company
          <input
            type="text"
            name="company"
            defaultValue={searchParams.company ?? ""}
            placeholder="Search company…"
            className="w-44 rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
          Category
          <select
            name="category"
            defaultValue={searchParams.category ?? ""}
            className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          >
            <option value="">All Categories</option>
            {distinctCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
          Dates
          <select
            name="dates"
            defaultValue={searchParams.dates ?? ""}
            className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          >
            <option value="">All Dates</option>
            <option value="ongoing">Ongoing</option>
            <option value="ended">Ended</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#D7D0C4]">
          Status
          <select
            name="status"
            defaultValue={searchParams.status ?? ""}
            className="rounded-md border border-white/20 bg-[#111513] px-3 py-2 text-sm text-[#F4F1EB] focus:border-[#2E7040] focus:outline-none"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="terminated">Terminated</option>
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md border border-[#2E7040]/60 bg-[#1B2F21] px-4 py-2 text-sm font-medium text-[#DBEEE0] hover:bg-[#234029] focus:outline-none"
        >
          Apply
        </button>
        <Link
          href="/contracts"
          className="rounded-md border border-white/20 px-4 py-2 text-sm text-[#D7D0C4] hover:bg-white/5"
        >
          Clear
        </Link>
      </form>

      {/* Table */}
      <div className="mt-8">
        <table className="min-w-full divide-y divide-white/15 rounded-xl border border-white/10 bg-[#121614]">
          <thead>
            <tr>
              {sortHeaders.map((h, i) => (
                <th
                  key={h.key}
                  className={`${i === 0 ? "py-3.5 pl-4" : "px-3 py-3.5"} text-left text-sm font-semibold text-[#F4F1EB]`}
                >
                  <Link
                    href={sortHref(h.key)}
                    className="inline-flex items-center gap-1 hover:text-[#CEE4D4]"
                  >
                    {h.label}
                    <span className={sort === h.key ? "text-[#CEE4D4]" : "text-white/30"}>
                      {sortIndicator(h.key)}
                    </span>
                  </Link>
                </th>
              ))}
              {profile.role !== "accounting" && (
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-[#F4F1EB]">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {contractsWithRelations?.map((contract: any) => (
              <tr key={contract.contract_id} className="hover:bg-white/5">
                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-[#F4F1EB] sm:pl-4">
                  <Link
                    href={`/athlete/${contract.athlete_id}`}
                    className="text-[#CEE4D4] hover:text-[#E8F6ED]"
                  >
                    {contract.athletes?.first_name || contract.athletes?.last_name
                      ? `${contract.athletes?.first_name ?? ""} ${contract.athletes?.last_name ?? ""}`.trim()
                      : "—"}
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
                {profile.role !== "accounting" && (
                  <td className="px-3 py-4 text-sm">
                    <ArchiveContractButton
                      contractId={contract.contract_id}
                      archived={contract.archived === true}
                      label
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
