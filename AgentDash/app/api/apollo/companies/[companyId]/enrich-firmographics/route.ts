import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { ApolloApiError } from "@/lib/apollo/client";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import {
  COMPANY_FIRMOGRAPHICS_DB_COLUMNS,
  mapCompanyFirmographics,
} from "@/lib/crm/company-firmographics";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body.force !== false;
  const apollo_organization_id =
    body.apollo_organization_id != null ? String(body.apollo_organization_id).trim() : undefined;

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await persistApolloMetadataForCompany(supabaseAdmin, companyId, {
      force,
      apollo_organization_id,
      userId: profile.user_id,
    });

    if ("needsConfirmation" in result && result.needsConfirmation) {
      return NextResponse.json({
        needsConfirmation: true,
        candidates: result.candidates,
        current: result.current,
        match_notes: result.match_notes,
      });
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select(COMPANY_FIRMOGRAPHICS_DB_COLUMNS)
      .eq("company_id", companyId)
      .single();

    return NextResponse.json({
      needsConfirmation: false,
      apollo_organization_id: result.apollo_organization_id,
      patched: "patched" in result ? result.patched : [],
      match_confidence: "match_confidence" in result ? result.match_confidence : null,
      match_notes: "match_notes" in result ? result.match_notes : null,
      firmographics: mapCompanyFirmographics(company ?? null),
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Firmographics enrichment failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
