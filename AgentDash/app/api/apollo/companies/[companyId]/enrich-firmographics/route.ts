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
  await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body.force !== false;

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await persistApolloMetadataForCompany(supabaseAdmin, companyId, { force });

    if ("needsConfirmation" in result && result.needsConfirmation) {
      return NextResponse.json(result);
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select(COMPANY_FIRMOGRAPHICS_DB_COLUMNS)
      .eq("company_id", companyId)
      .single();

    return NextResponse.json({
      apollo_organization_id: result.apollo_organization_id,
      patched: result.patched,
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
