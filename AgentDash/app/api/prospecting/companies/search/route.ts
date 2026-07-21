import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { searchApolloOrganizationsAdvanced } from "@/lib/apollo/organizations";
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
 * POST /api/prospecting/companies/search
 */
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo is not enabled" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const keyword_tags = splitCsv(body.keyword_tags ?? body.keywords);
  const q_organization_name = String(body.q_organization_name ?? body.name ?? "").trim() || undefined;
  const organization_locations = splitCsv(body.organization_locations ?? body.locations);
  const organization_num_employees_ranges = splitCsv(
    body.organization_num_employees_ranges ?? body.headcount_ranges
  );
  const page = Math.max(1, Number(body.page) || 1);
  const per_page = Math.min(50, Math.max(1, Number(body.per_page) || 25));

  if (
    !keyword_tags.length &&
    !q_organization_name &&
    !organization_locations.length &&
    !organization_num_employees_ranges.length
  ) {
    return NextResponse.json(
      { error: "Provide at least one search filter (keywords, name, location, or headcount)" },
      { status: 400 }
    );
  }

  try {
    const result = await searchApolloOrganizationsAdvanced({
      keyword_tags: keyword_tags.length ? keyword_tags : undefined,
      q_organization_name,
      organization_locations: organization_locations.length ? organization_locations : undefined,
      organization_num_employees_ranges: organization_num_employees_ranges.length
        ? organization_num_employees_ranges
        : undefined,
      page,
      per_page,
    });

    const supabaseAdmin = await createServiceRoleClient();
    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "mixed_companies/search",
    }).catch(() => undefined);

    return NextResponse.json({
      organizations: result.organizations,
      pagination: result.pagination ?? {
        page,
        per_page,
        total_entries: result.organizations.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Company search failed" },
      { status: 500 }
    );
  }
}
