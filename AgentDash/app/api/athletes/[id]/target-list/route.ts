import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

/**
 * GET /api/athletes/:id/target-list
 *
 * Returns the spreadsheet-ready target list for an athlete: every pipeline card
 * (crm_companies_pipeline) where the athlete appears in `potential_athletes`,
 * plus all crm_contacts for the same company that the viewer can see (RLS
 * scopes agents to their own contacts).
 */
export type TargetListContact = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type TargetListRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
  website: string | null;
  hq_phone: string | null;
  company_description: string | null;
  past_partnerships: string | null;
  personal_notes: string | null;
  contacts: TargetListContact[];
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const { data: pipelineRows, error: pipelineErr } = await supabase
    .from("crm_companies_pipeline")
    .select(
      `
        id,
        company_id,
        potential_athletes,
        company_description,
        past_partnerships,
        personal_notes,
        archived,
        companies(name, website, hq_phone, product_category, notes)
      `
    )
    .eq("archived", false);
  if (pipelineErr) {
    return NextResponse.json({ error: pipelineErr.message }, { status: 500 });
  }

  const assigned = (pipelineRows ?? []).filter((r: any) => {
    const arr = Array.isArray(r.potential_athletes) ? r.potential_athletes : [];
    return arr.some((p: any) => p && typeof p === "object" && String(p.athlete_id ?? "") === athleteId);
  });

  if (assigned.length === 0) {
    return NextResponse.json({ rows: [] as TargetListRow[] });
  }

  const companyIds = [...new Set(assigned.map((r: any) => r.company_id).filter(Boolean))];

  const { data: contactRows, error: contactErr } = await supabase
    .from("crm_contacts")
    .select("contact_id, company_id, first_name, last_name, role, email, phone, notes, archived")
    .in("company_id", companyIds)
    .eq("archived", false);
  if (contactErr) {
    return NextResponse.json({ error: contactErr.message }, { status: 500 });
  }

  const contactsByCompany = new Map<string, TargetListContact[]>();
  for (const c of contactRows ?? []) {
    const list = contactsByCompany.get(c.company_id) ?? [];
    list.push({
      contact_id: c.contact_id,
      first_name: c.first_name ?? "",
      last_name: c.last_name ?? "",
      role: c.role ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      notes: c.notes ?? null,
    });
    contactsByCompany.set(c.company_id, list);
  }

  const rows: TargetListRow[] = assigned.map((r: any) => {
    const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    const category = company?.product_category ? String(company.product_category) : null;
    const contacts = (contactsByCompany.get(r.company_id) ?? []).slice().sort((a, b) => {
      const aName = `${a.last_name} ${a.first_name}`.trim().toLowerCase();
      const bName = `${b.last_name} ${b.first_name}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    });
    return {
      pipeline_id: r.id,
      company_id: r.company_id,
      company_name: String(company?.name ?? ""),
      category,
      website: company?.website ?? null,
      hq_phone: company?.hq_phone ?? null,
      company_description: r.company_description ?? null,
      past_partnerships: r.past_partnerships ?? null,
      personal_notes: r.personal_notes ?? null,
      contacts,
    };
  });

  const UNCATEGORIZED = "\uFFFFUncategorized";
  rows.sort((a, b) => {
    const ca = (a.category ?? UNCATEGORIZED).toLowerCase();
    const cb = (b.category ?? UNCATEGORIZED).toLowerCase();
    const catCmp = ca.localeCompare(cb);
    if (catCmp !== 0) return catCmp;
    return a.company_name.localeCompare(b.company_name, undefined, { sensitivity: "base" });
  });

  return NextResponse.json({ rows });
}
