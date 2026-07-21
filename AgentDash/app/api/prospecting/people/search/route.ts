import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { searchPeopleGlobal } from "@/lib/apollo/people-search";
import { logApolloUsage } from "@/lib/apollo/usage";
import { NextResponse } from "next/server";

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  const s = String(value ?? "").trim();
  if (!s) return [];
  return s
    .split(/[,|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * POST /api/prospecting/people/search
 * Global Apollo people search (not org-scoped). Search is free; reveals are separate.
 */
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo is not enabled" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const person_titles = splitCsv(body.person_titles ?? body.titles);
  const person_seniorities = splitCsv(body.person_seniorities ?? body.seniorities);
  const person_locations = splitCsv(body.person_locations ?? body.locations);
  const organization_locations = splitCsv(body.organization_locations);
  const organization_domains = splitCsv(body.organization_domains ?? body.domains);
  const q_keywords = String(body.q_keywords ?? body.keywords ?? "").trim() || undefined;
  const q_organization_name =
    String(body.q_organization_name ?? body.company ?? "").trim() || undefined;
  const page = Math.max(1, Number(body.page) || 1);
  const per_page = Math.min(25, Math.max(1, Number(body.per_page) || 25));

  if (
    !person_titles.length &&
    !person_seniorities.length &&
    !person_locations.length &&
    !organization_locations.length &&
    !organization_domains.length &&
    !q_keywords &&
    !q_organization_name
  ) {
    return NextResponse.json(
      { error: "Provide at least one search filter (titles, keywords, company, or location)" },
      { status: 400 }
    );
  }

  try {
    const result = await searchPeopleGlobal({
      person_titles: person_titles.length ? person_titles : undefined,
      person_seniorities: person_seniorities.length ? person_seniorities : undefined,
      person_locations: person_locations.length ? person_locations : undefined,
      organization_locations: organization_locations.length ? organization_locations : undefined,
      organization_domains: organization_domains.length ? organization_domains : undefined,
      q_keywords,
      q_organization_name,
      page,
      per_page,
    });

    const supabaseAdmin = await createServiceRoleClient();
    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "api_search",
    }).catch(() => undefined);

    return NextResponse.json({
      people: result.people,
      pagination: result.pagination ?? { page, per_page, total_entries: result.people.length },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "People search failed" },
      { status: 500 }
    );
  }
}
