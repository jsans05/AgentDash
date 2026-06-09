import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { findContactsForCompany } from "@/lib/apollo/find-company-contacts";
import { ApolloApiError } from "@/lib/apollo/client";
import type { ApolloPeopleSearchOverrides } from "@/lib/apollo/search-defaults";

export async function POST(req: Request) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const companyIds = Array.isArray(body.company_ids)
    ? ([...new Set(body.company_ids.map((id: unknown) => String(id)).filter(Boolean))] as string[])
    : [];

  if (companyIds.length === 0) {
    return NextResponse.json({ error: "company_ids required" }, { status: 400 });
  }
  if (companyIds.length > 80) {
    return NextResponse.json({ error: "Max 80 companies per bulk request" }, { status: 400 });
  }

  const overrides: ApolloPeopleSearchOverrides = {};
  if (Array.isArray(body.organization_locations)) {
    overrides.organization_locations = body.organization_locations.map(String);
  }
  if (body.revenue_range?.min != null) overrides.revenue_range_min = Number(body.revenue_range.min);
  if (body.revenue_range?.max != null) overrides.revenue_range_max = Number(body.revenue_range.max);

  const supabaseAdmin = await createServiceRoleClient();
  const results: Array<{
    company_id: string;
    ok: boolean;
    found?: number;
    created?: number;
    updated?: number;
    contacts?: unknown[];
    error?: string;
  }> = [];

  for (const companyId of companyIds) {
    try {
      const result = await findContactsForCompany(supabaseAdmin, {
        userId: profile.user_id,
        companyId,
        overrides,
      });
      results.push({
        company_id: companyId,
        ok: true,
        found: result.found,
        created: result.created,
        updated: result.updated,
        contacts: result.contacts,
      });
    } catch (e) {
      const msg =
        e instanceof ApolloApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed";
      results.push({ company_id: companyId, ok: false, error: msg });
    }
  }

  const summary = {
    companies: companyIds.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    total_found: results.reduce((n, r) => n + (r.found ?? 0), 0),
    total_created: results.reduce((n, r) => n + (r.created ?? 0), 0),
  };

  return NextResponse.json({ summary, results });
}
