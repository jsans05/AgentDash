"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeHttpUrl } from "@/lib/security/url";

type Tab = "people" | "companies";

type MyAthlete = {
  athlete_id: string;
  name: string;
  sport: string | null;
};

type ProspectPerson = {
  apollo_person_id: string;
  first_name: string;
  last_name: string;
  title: string;
  organization_name: string;
  organization_domain?: string;
  organization_id?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
  has_email: boolean;
  has_phone?: boolean;
  email_status?: string;
};

type ProspectOrg = {
  apollo_organization_id: string | null;
  name: string;
  industry?: string;
  website?: string;
  description?: string;
  primary_domain?: string;
  estimated_num_employees?: number;
  city?: string;
  state?: string;
  country?: string;
};

const HEADCOUNT_OPTIONS = [
  { value: "1,10", label: "1–10" },
  { value: "11,50", label: "11–50" },
  { value: "51,200", label: "51–200" },
  { value: "201,500", label: "201–500" },
  { value: "501,1000", label: "501–1,000" },
  { value: "1001,5000", label: "1,001–5,000" },
  { value: "5001,10000", label: "5,001–10,000" },
  { value: "10001,", label: "10,000+" },
];

function personKey(p: ProspectPerson): string {
  return p.apollo_person_id;
}

function orgKey(o: ProspectOrg): string {
  return o.apollo_organization_id || o.primary_domain || o.name;
}

function locationLabel(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(", ") || "—";
}

export function ProspectingClient() {
  const [tab, setTab] = useState<Tab>("people");
  const [athletes, setAthletes] = useState<MyAthlete[]>([]);
  const [athletesError, setAthletesError] = useState<string | null>(null);

  // People filters
  const [titles, setTitles] = useState("");
  const [keywords, setKeywords] = useState("");
  const [company, setCompany] = useState("");
  const [locations, setLocations] = useState("");

  // Company filters
  const [orgKeywords, setOrgKeywords] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgLocations, setOrgLocations] = useState("");
  const [headcount, setHeadcount] = useState("");

  const [people, setPeople] = useState<ProspectPerson[]>([]);
  const [orgs, setOrgs] = useState<ProspectOrg[]>([]);
  const [peoplePage, setPeoplePage] = useState(1);
  const [orgsPage, setOrgsPage] = useState(1);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [orgsTotal, setOrgsTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());
  const [onListKeys, setOnListKeys] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<string | null>(null);
  const [lastAthleteId, setLastAthleteId] = useState<string | null>(null);
  const [lastAthleteName, setLastAthleteName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/my-athletes");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAthletesError(data?.error ?? "Failed to load athletes");
          return;
        }
        setAthletes(Array.isArray(data.athletes) ? data.athletes : []);
      } catch (e) {
        setAthletesError(e instanceof Error ? e.message : "Failed to load athletes");
      }
    })();
  }, []);

  const selectedCount =
    tab === "people" ? selectedPeople.size : selectedOrgs.size;

  const searchPeople = useCallback(
    async (page = 1) => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch("/api/prospecting/people/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person_titles: titles,
            q_keywords: keywords,
            q_organization_name: company,
            person_locations: locations,
            page,
            per_page: 25,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchError(data?.error ?? "People search failed");
          setPeople([]);
          return;
        }
        setPeople(Array.isArray(data.people) ? data.people : []);
        setPeoplePage(page);
        setPeopleTotal(Number(data?.pagination?.total_entries) || 0);
        setSelectedPeople(new Set());
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "People search failed");
      } finally {
        setSearching(false);
      }
    },
    [titles, keywords, company, locations]
  );

  const searchCompanies = useCallback(
    async (page = 1) => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch("/api/prospecting/companies/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword_tags: orgKeywords,
            q_organization_name: orgName,
            organization_locations: orgLocations,
            organization_num_employees_ranges: headcount ? [headcount] : [],
            page,
            per_page: 25,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchError(data?.error ?? "Company search failed");
          setOrgs([]);
          return;
        }
        setOrgs(Array.isArray(data.organizations) ? data.organizations : []);
        setOrgsPage(page);
        setOrgsTotal(Number(data?.pagination?.total_entries) || 0);
        setSelectedOrgs(new Set());
      } catch (e) {
        setSearchError(e instanceof Error ? e.message : "Company search failed");
      } finally {
        setSearching(false);
      }
    },
    [orgKeywords, orgName, orgLocations, headcount]
  );

  async function addToList(athleteId: string) {
    if (selectedCount === 0 || adding) return;
    const athlete = athletes.find((a) => a.athlete_id === athleteId);
    setAdding(true);
    setAddResult(null);
    try {
      const items =
        tab === "people"
          ? people
              .filter((p) => selectedPeople.has(personKey(p)))
              .map((p) => ({
                type: "person" as const,
                company_name: p.organization_name || "Unknown company",
                website: p.organization_domain
                  ? `https://${p.organization_domain.replace(/^https?:\/\//, "")}`
                  : null,
                apollo_organization_id: p.organization_id ?? null,
                person: {
                  apollo_person_id: p.apollo_person_id,
                  first_name: p.first_name,
                  last_name: p.last_name,
                  title: p.title,
                  linkedin_url: p.linkedin_url,
                  has_email: p.has_email,
                  email_status: p.email_status,
                },
              }))
          : orgs
              .filter((o) => selectedOrgs.has(orgKey(o)))
              .map((o) => ({
                type: "company" as const,
                company_name: o.name,
                website: o.website || (o.primary_domain ? `https://${o.primary_domain}` : null),
                apollo_organization_id: o.apollo_organization_id,
                industry: o.industry ?? null,
              }));

      const res = await fetch("/api/prospecting/add-to-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athlete_id: athleteId, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddResult(data?.error ?? "Failed to add to list");
        return;
      }

      const keys =
        tab === "people"
          ? [...selectedPeople]
          : [...selectedOrgs];
      setOnListKeys((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.add(k);
        return next;
      });
      setSelectedPeople(new Set());
      setSelectedOrgs(new Set());
      setAddOpen(false);
      setLastAthleteId(athleteId);
      setLastAthleteName(String(data.athlete_name ?? athlete?.name ?? ""));
      setAddResult(
        `Added ${data.added ?? 0}` +
          (data.already_on_list ? `, ${data.already_on_list} already on list` : "") +
          (data.failed ? `, ${data.failed} failed` : "") +
          ` → ${data.athlete_name ?? athlete?.name ?? "list"}`
      );
    } catch (e) {
      setAddResult(e instanceof Error ? e.message : "Failed to add to list");
    } finally {
      setAdding(false);
    }
  }

  const peopleAllSelected = useMemo(
    () => people.length > 0 && people.every((p) => selectedPeople.has(personKey(p))),
    [people, selectedPeople]
  );
  const orgsAllSelected = useMemo(
    () => orgs.length > 0 && orgs.every((o) => selectedOrgs.has(orgKey(o))),
    [orgs, selectedOrgs]
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="flex gap-1 rounded-xl border border-white/10 bg-[#0F1311] p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab("people")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm transition-colors",
            tab === "people"
              ? "bg-[#2E7040] text-[#F2FFF5]"
              : "text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
          )}
        >
          People
        </button>
        <button
          type="button"
          onClick={() => setTab("companies")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm transition-colors",
            tab === "companies"
              ? "bg-[#2E7040] text-[#F2FFF5]"
              : "text-[#B9B2A6] hover:bg-white/5 hover:text-[#F4F1EB]"
          )}
        >
          Companies
        </button>
      </div>

      {tab === "people" ? (
        <form
          className="grid gap-3 rounded-lg border border-white/10 bg-[#121714] p-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void searchPeople(1);
          }}
        >
          <label className="block text-xs text-[#B9B2A6]">
            Titles
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="e.g. Partnerships Manager, Brand Director"
              value={titles}
              onChange={(e) => setTitles(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Keywords
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="e.g. sports marketing"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Company
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="Company name"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Location
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="e.g. United States, New York"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={searching} className="h-8 text-xs">
              {searching ? "Searching…" : "Search people"}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="grid gap-3 rounded-lg border border-white/10 bg-[#121714] p-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            void searchCompanies(1);
          }}
        >
          <label className="block text-xs text-[#B9B2A6]">
            Keywords / industry
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="e.g. athletic apparel"
              value={orgKeywords}
              onChange={(e) => setOrgKeywords(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Company name
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="Exact or partial name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Location
            <input
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              placeholder="e.g. United States"
              value={orgLocations}
              onChange={(e) => setOrgLocations(e.target.value)}
            />
          </label>
          <label className="block text-xs text-[#B9B2A6]">
            Headcount
            <select
              className="mt-1 w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-sm text-[#ECE7DF]"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
            >
              <option value="">Any</option>
              {HEADCOUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={searching} className="h-8 text-xs">
              {searching ? "Searching…" : "Search companies"}
            </Button>
          </div>
        </form>
      )}

      {searchError ? (
        <div className="rounded-md border border-[#8C3A3A]/50 bg-[#3A1E1E] px-3 py-2 text-xs text-[#F1A2A2]">
          {searchError}
        </div>
      ) : null}
      {addResult ? (
        <div className="rounded-md border border-[#2E7040]/40 bg-[#1B2F21] px-3 py-2 text-xs text-[#DBEEE0]">
          {addResult}
          {lastAthleteId ? (
            <>
              {" · "}
              <Link
                href={`/athlete/${lastAthleteId}?tab=outreach`}
                className="underline hover:text-[#F2FFF5]"
              >
                Open {lastAthleteName ?? "target list"}
              </Link>
            </>
          ) : null}
        </div>
      ) : null}
      {athletesError ? (
        <div className="text-xs text-[#F1A2A2]">{athletesError}</div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="relative flex flex-wrap items-center gap-2 rounded-md border border-[#2E7040]/40 bg-[#1A2A20] px-3 py-2 text-sm">
          <span className="font-medium text-[#A7E0B6]">{selectedCount} selected</span>
          <div className="relative">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={adding || athletes.length === 0}
              onClick={() => setAddOpen((v) => !v)}
            >
              {adding ? "Adding…" : "Add to list"}
            </Button>
            {addOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close"
                  onClick={() => setAddOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 max-h-64 min-w-[220px] overflow-y-auto rounded-md border border-white/15 bg-[#151A17] py-1 shadow-xl">
                  {athletes.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[#B9B2A6]">No athletes available</div>
                  ) : (
                    athletes.map((a) => (
                      <button
                        key={a.athlete_id}
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-sm text-[#ECE7DF] hover:bg-white/10"
                        disabled={adding}
                        onClick={() => void addToList(a.athlete_id)}
                      >
                        <span className="font-medium">{a.name}</span>
                        {a.sport ? (
                          <span className="text-[11px] text-[#8E877A]">{a.sport}</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-white/10">
        {tab === "people" ? (
          <table className="min-w-full text-sm">
            <thead className="bg-[#1A211D] text-[11px] uppercase tracking-wide text-[#8E877A]">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={peopleAllSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPeople(new Set(people.map(personKey)));
                      } else {
                        setSelectedPeople(new Set());
                      }
                    }}
                    aria-label="Select all people"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Title</th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">LinkedIn</th>
                <th className="px-3 py-2 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-[#B9B2A6]">
                    {searching ? "Searching…" : "Run a search to find people."}
                  </td>
                </tr>
              ) : (
                people.map((p) => {
                  const key = personKey(p);
                  const linkedin = p.linkedin_url ? safeHttpUrl(p.linkedin_url) : null;
                  return (
                    <tr key={key} className="border-t border-white/10 hover:bg-white/[0.03]">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedPeople.has(key)}
                          onChange={(e) => {
                            setSelectedPeople((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          aria-label={`Select ${p.first_name} ${p.last_name}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[#ECE7DF]">
                        {p.first_name} {p.last_name}
                      </td>
                      <td className="px-3 py-2 text-[#D7D0C4]">{p.title || "—"}</td>
                      <td className="px-3 py-2 text-[#D7D0C4]">
                        {p.organization_name || "—"}
                        {p.organization_domain ? (
                          <span className="block text-[11px] text-[#8E877A]">
                            {p.organization_domain}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[#B9B2A6]">
                        {locationLabel([p.city, p.state, p.country])}
                      </td>
                      <td className="px-3 py-2 text-[#B9B2A6]">
                        {p.has_email ? "🔒 Available" : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {linkedin ? (
                          <a
                            href={linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#CEE4D4] hover:underline"
                          >
                            Profile
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {onListKeys.has(key) ? (
                          <span className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] text-[#DBEEE0]">
                            On list
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-[#1A211D] text-[11px] uppercase tracking-wide text-[#8E877A]">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={orgsAllSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedOrgs(new Set(orgs.map(orgKey)));
                      } else {
                        setSelectedOrgs(new Set());
                      }
                    }}
                    aria-label="Select all companies"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Industry</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
                <th className="px-3 py-2 text-left font-medium">Employees</th>
                <th className="px-3 py-2 text-left font-medium">Website</th>
                <th className="px-3 py-2 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-[#B9B2A6]">
                    {searching ? "Searching…" : "Run a search to find companies."}
                  </td>
                </tr>
              ) : (
                orgs.map((o) => {
                  const key = orgKey(o);
                  const website = o.website
                    ? safeHttpUrl(o.website)
                    : o.primary_domain
                      ? safeHttpUrl(`https://${o.primary_domain}`)
                      : null;
                  return (
                    <tr key={key} className="border-t border-white/10 hover:bg-white/[0.03]">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedOrgs.has(key)}
                          onChange={(e) => {
                            setSelectedOrgs((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          aria-label={`Select ${o.name}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-[#ECE7DF]">{o.name}</td>
                      <td className="px-3 py-2 text-[#D7D0C4]">{o.industry || "—"}</td>
                      <td className="px-3 py-2 text-[#B9B2A6]">
                        {locationLabel([o.city, o.state, o.country])}
                      </td>
                      <td className="px-3 py-2 text-[#B9B2A6]">
                        {o.estimated_num_employees != null
                          ? o.estimated_num_employees.toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {website ? (
                          <a
                            href={website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#CEE4D4] hover:underline"
                          >
                            {(o.primary_domain || o.website || "").replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {onListKeys.has(key) ? (
                          <span className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] text-[#DBEEE0]">
                            On list
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {tab === "people" && people.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-[#B9B2A6]">
          <span>
            Page {peoplePage}
            {peopleTotal ? ` · ~${peopleTotal.toLocaleString()} total` : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={searching || peoplePage <= 1}
            onClick={() => void searchPeople(peoplePage - 1)}
          >
            Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={searching || people.length < 25}
            onClick={() => void searchPeople(peoplePage + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
      {tab === "companies" && orgs.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-[#B9B2A6]">
          <span>
            Page {orgsPage}
            {orgsTotal ? ` · ~${orgsTotal.toLocaleString()} total` : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={searching || orgsPage <= 1}
            onClick={() => void searchCompanies(orgsPage - 1)}
          >
            Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={searching || orgs.length < 25}
            onClick={() => void searchCompanies(orgsPage + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
