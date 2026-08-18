import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { findContactsForCompany } from "@/lib/apollo/find-company-contacts";
import { ApolloApiError } from "@/lib/apollo/client";
import { parseContactSearchOverridesFromBody } from "@/lib/apollo/contact-search-api-body";
import { apolloContactOverridesToPeopleSearch } from "@/lib/apollo/search-defaults";
import { resolveCrmWriteOwnerUserId } from "@/lib/crm/assigned-row-access";

export async function POST(req: Request) {
  const profile = await requireNonAccounting();
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

  const overrides = apolloContactOverridesToPeopleSearch(
    parseContactSearchOverridesFromBody(body as Record<string, unknown>)
  );
  const consultingProfileId =
    body.consulting_profile_id != null ? String(body.consulting_profile_id).trim() || null : null;
  const rawOwners =
    body.company_owners && typeof body.company_owners === "object" && !Array.isArray(body.company_owners)
      ? (body.company_owners as Record<string, unknown>)
      : {};

  const supabaseAdmin = await createServiceRoleClient();
  const results: Array<{
    company_id: string;
    ok: boolean;
    found?: number;
    created?: number;
    updated?: number;
    contacts?: unknown[];
    hq_phone?: string | null;
    error?: string;
  }> = [];

  for (const companyId of companyIds) {
    try {
      const writeOwnerUserId = await resolveCrmWriteOwnerUserId(
        supabaseAdmin,
        profile,
        companyId,
        rawOwners[companyId] != null ? String(rawOwners[companyId]) : null
      );
      const result = await findContactsForCompany(supabaseAdmin, {
        userId: writeOwnerUserId,
        companyId,
        overrides,
        consultingProfileId: consultingProfileId ?? undefined,
      });
      results.push({
        company_id: companyId,
        ok: true,
        found: result.found,
        created: result.created,
        updated: result.updated,
        contacts: result.contacts,
        hq_phone: result.hq_phone,
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
