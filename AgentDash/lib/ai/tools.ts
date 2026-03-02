/**
 * AI tool functions for database access (read-only in v1)
 */

import { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/supabase/types";
import { getAudienceMetrics } from "@/lib/audience-metrics";
import { getTaxonomyBySport } from "@/lib/taxonomy";

async function agentCanAccessAthlete(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  profile: Profile,
  athlete_id: string
): Promise<boolean> {
  if (profile.role === "admin" || profile.role === "sales") return true;
  if (profile.role !== "agent") return false;
  const { data: athlete } = await supabase
    .from("athletes")
    .select("current_agent_id")
    .eq("athlete_id", athlete_id)
    .single();
  if (athlete?.current_agent_id === profile.user_id) return true;
  const { data: links } = await supabase
    .from("athlete_agents")
    .select("user_id")
    .eq("athlete_id", athlete_id)
    .eq("user_id", profile.user_id)
    .limit(1);
  return Boolean(links && links.length > 0);
}

export async function createAITools(profile: Profile) {
  const supabase = await createServerClient();

  return {
    listAthletesScoped: async (params?: { sport?: string }) => {
      let query = supabase.from("athletes").select("athlete_id, first_name, last_name, sport, country, creatoriq_publisher_id");
      if (profile.role === "agent") {
        query = query.eq("current_agent_id", profile.user_id);
      }
      if (params?.sport?.trim()) {
        query = query.ilike("sport", `%${params.sport.trim()}%`);
      }
      const { data } = await query.order("last_name");
      return data || [];
    },

    getAthlete: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      const { data } = await supabase
        .from("athletes")
        .select("*")
        .eq("athlete_id", athlete_id)
        .single();
      if (!data) return null;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return null;
      }
      return data;
    },

    getAthleteAgents: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return [];
      }
      const { data } = await supabase
        .from("athlete_agents")
        .select(`
          user_id,
          is_primary,
          profiles:user_id (first_name, last_name, email)
        `)
        .eq("athlete_id", athlete_id)
        .order("is_primary", { ascending: false });
      if (!data) return [];
      return data.map((row: any) => ({
        user_id: row.user_id,
        is_primary: row.is_primary,
        first_name: row.profiles?.first_name,
        last_name: row.profiles?.last_name,
        email: row.profiles?.email,
        name: [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ") || null,
      }));
    },

    getAthleteContracts: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return [];
      }
      const { data: contractsList } = await supabase
        .from("contracts")
        .select("*")
        .eq("athlete_id", athlete_id)
        .order("status", { ascending: false })
        .order("start_date", { ascending: false });
      if (!contractsList?.length) return [];

      const companyIds = [...new Set(contractsList.map((c: any) => c.company_id).filter(Boolean))];
      const contractIds = contractsList.map((c: any) => c.contract_id);
      const [companiesRes, exclusivitiesRes] = await Promise.all([
        companyIds.length > 0 ? supabase.from("companies").select("company_id, name").in("company_id", companyIds) : { data: [] },
        contractIds.length > 0
          ? supabase
              .from("contract_exclusivities")
              .select("contract_id, sponsorship_taxonomies:taxonomy_id(category)")
              .in("contract_id", contractIds)
          : { data: [] },
      ]);
      const companyMap = new Map((companiesRes?.data ?? []).map((c: any) => [c.company_id, c.name]));
      const categoriesByContract = new Map<string, string[]>();
      for (const e of exclusivitiesRes?.data ?? []) {
        const list = categoriesByContract.get((e as any).contract_id) ?? [];
        const cat = (e as any).sponsorship_taxonomies?.category;
        if (cat) list.push(cat);
        categoriesByContract.set((e as any).contract_id, list);
      }

      return contractsList.map((c: any) => ({
        ...c,
        companies: companyMap.get(c.company_id) ? { name: companyMap.get(c.company_id) } : null,
        category_labels: categoriesByContract.get(c.contract_id) ?? [],
      }));
    },

    getCompanyByName: async (params: { name: string }) => {
      const { data } = await supabase
        .from("companies")
        .select("*")
        .eq("name", params.name)
        .single();
      return data;
    },

    getCompanySponsorships: async (params: { company_id: string }) => {
      const { data } = await supabase
        .from("contracts")
        .select(`
          *,
          athletes (*)
        `)
        .eq("company_id", params.company_id)
        .eq("status", "active");
      return data || [];
    },

    getCompanyContacts: async (params: { company_id: string }) => {
      const { data } = await supabase
        .from("company_contacts")
        .select("*")
        .eq("company_id", params.company_id);
      return data || [];
    },

    getLatestCIQSnapshots: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) return [];

      const { data } = await supabase
        .from("creatoriq_snapshots")
        .select("*")
        .eq("athlete_id", athlete_id)
        .order("fetched_at", { ascending: false })
        .limit(10);
      return data || [];
    },

    getAthleteCoveredCategories: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) return { category_names: [] };
      const { data } = await supabase
        .from("athlete_covered_categories")
        .select("sponsorship_taxonomies:taxonomy_id(category)")
        .eq("athlete_id", athlete_id);
      const category_names = (data || [])
        .map((r: any) => r.sponsorship_taxonomies?.category)
        .filter(Boolean);
      return { category_names };
    },

    /** Unified audience for an athlete (CreatorIQ or manual fallback). Use for prospecting fit. */
    getAthleteAudience: async (params: { athlete_id: string }) => {
      const athlete_id = params.athlete_id;
      if (!(await agentCanAccessAthlete(supabase, profile, athlete_id))) {
        return { summary: null, source: null };
      }
      const result = await getAudienceMetrics(supabase, athlete_id);
      return {
        summary: result.summary,
        source: result.source,
        fetchedAt: result.fetchedAt,
      };
    },

    /** Taxonomy categories for a sport (endemic + non-endemic). Resolves roster sport aliases. Use to determine missing sponsor categories when prospecting. */
    getTaxonomyForSport: async (params: { sport: string }) => {
      const { endemic, nonEndemic } = await getTaxonomyBySport(params.sport?.trim() || null);
      return { endemic, nonEndemic };
    },
  };
}
