import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { CrmCompaniesPipeline } from "@/components/crm/CrmCompaniesPipeline";
import { CrmBrandIdeaQuickAdd } from "@/components/crm/CrmBrandIdeaQuickAdd";

export default async function CrmCompaniesPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    stage?: string;
    archived?: string;
    categories?: string | string[];
    industries?: string | string[];
  }>;
}) {
  const searchParams = await searchParamsPromise;
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status?.trim() || "in_progress";
  const stage = searchParams.stage?.trim() || "all";
  const archived = searchParams.archived === "1";
  const sort = searchParams.sort?.trim() || "updated_desc";
  const selectedCategoriesRaw =
    searchParams.categories ?? searchParams.industries ?? [];
  const selectedCategories =
    typeof selectedCategoriesRaw === "string"
      ? [selectedCategoriesRaw]
      : Array.isArray(selectedCategoriesRaw)
        ? selectedCategoriesRaw
        : [];

  const profile = await requireProfile();
  const supabase = await createServerClient();

  let query = supabase
    .from("crm_companies_pipeline")
    .select("id, status, support_email, contact_emails, relevant_people, notes, funnel_stage, priority, next_follow_up_at, archived, sent_at, updated_at, companies(name, industry, website, instagram_url, support_email)")
    .order(
      sort === "sent_desc" || sort === "sent_asc" ? "sent_at" : sort === "created_desc" || sort === "created_asc" ? "created_at" : "updated_at",
      { ascending: sort === "sent_asc" || sort === "created_asc" }
    );

  if (profile.role === "agent") {
    query = query.eq("created_by_user_id", profile.user_id);
  }
  if (status === "in_progress" || status === "promoted_to_crm") {
    query = query.eq("status", status);
  }
  if (stage && stage !== "all") {
    query = query.eq("funnel_stage", stage);
  }
  query = query.eq("archived", archived);
  if (selectedCategories.length > 0) {
    const { data: companyCategoryRows } = await supabase
      .from("companies")
      .select("company_id")
      .in("industry", selectedCategories);

    const { data: contactCategoryRows } = await supabase
      .from("crm_contacts")
      .select("company_id")
      .in("category", selectedCategories);

    const companyIds = [
      ...new Set(
        [...(companyCategoryRows ?? []), ...(contactCategoryRows ?? [])]
          .map((r: any) => r.company_id)
          .filter(Boolean)
      ),
    ];
    if (companyIds.length === 0) {
      query = query.limit(0);
    } else {
      query = query.in("company_id", companyIds);
    }
  }
  if (q) {
    const { data: companyMatches } = await supabase.from("companies").select("company_id").ilike("name", `%${q}%`);
    const companyIds = (companyMatches ?? []).map((r: any) => r.company_id);
    if (companyIds.length === 0) {
      query = query.limit(0);
    } else {
      query = query.in("company_id", companyIds);
    }
  }

  const { data } = await query;
  const rows = (data ?? []) as any[];

  const { data: industryRows } = await supabase
    .from("companies")
    .select("industry")
    .not("industry", "is", null)
    .order("industry", { ascending: true });
  const { data: crmCategoryRows } = await supabase
    .from("crm_contacts")
    .select("category")
    .not("category", "is", null)
    .order("category", { ascending: true });
  const availableCategories = [
    ...new Set(
      [...(industryRows ?? []).map((r: any) => r.industry), ...(crmCategoryRows ?? []).map((r: any) => r.category)]
        .map((v: any) => String(v ?? "").trim())
        .filter(Boolean)
    ),
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-[#F4F1EB]">CRM Companies In Progress</h1>
          <p className="mt-2 text-sm text-[#D7D0C4]">
            Track AI-prospected companies, collect contact/support emails, then promote into main CRM contacts.
          </p>
        </div>
        <div className="mt-3 sm:mt-0">
          <Link
            href="/crm"
            prefetch={false}
            className="inline-flex items-center rounded-md bg-[#2E7040] px-4 py-2 text-sm font-medium text-white hover:bg-[#285F36]"
          >
            Back to CRM
          </Link>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-white/10 bg-[#151A17] p-4 shadow">
        <h2 className="text-sm font-medium text-[#F4F1EB]">Quick Add Brand Idea</h2>
        <CrmBrandIdeaQuickAdd />
      </div>

      <div className="space-y-4 rounded-lg border border-white/10 bg-[#151A17] p-4 shadow">
        <h2 className="text-sm font-medium text-[#F4F1EB]">Filters</h2>
        <form method="GET" action="/crm/companies" className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search company name..."
            className="min-w-[220px] rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF] placeholder:text-[#8E877A]"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
          >
            <option value="in_progress">In Progress</option>
            <option value="promoted_to_crm">Promoted to CRM</option>
            <option value="all">All Statuses</option>
          </select>
          <select
            name="stage"
            defaultValue={stage}
            className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
          >
            <option value="all">All Stages</option>
            <option value="idea">Idea</option>
            <option value="research">Research</option>
            <option value="contacted">Contacted</option>
            <option value="negotiating">Negotiating</option>
            <option value="paused">Paused</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-[#D7D0C4]">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={archived}
              className="h-4 w-4 rounded border-white/20 bg-[#101513] text-[#2E7040] focus:ring-[#2E7040]"
            />
            Show archived
          </label>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
          >
            <option value="updated_desc">Sort: Updated (Newest)</option>
            <option value="created_desc">Sort: Created (Newest)</option>
            <option value="created_asc">Sort: Created (Oldest)</option>
            <option value="sent_desc">Sort: Sent (Newest)</option>
            <option value="sent_asc">Sort: Sent (Oldest)</option>
          </select>
          <select
            name="categories"
            defaultValue={selectedCategories}
            multiple
            size={Math.min(Math.max(availableCategories.length, 3), 6)}
            className="min-w-[220px] rounded-md border border-white/20 bg-[#101513] px-3 py-2 text-sm text-[#ECE7DF]"
            title="Hold Cmd/Ctrl to select multiple"
          >
            {availableCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-[#2E7040] px-4 py-2 text-sm text-white hover:bg-[#285F36]">
            Apply
          </button>
        </form>
      </div>
      <CrmCompaniesPipeline rows={rows} />
    </div>
  );
}
