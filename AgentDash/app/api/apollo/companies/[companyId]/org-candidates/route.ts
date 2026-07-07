import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { listApolloOrganizationCandidates } from "@/lib/apollo/resolve-organization";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ApolloApiError } from "@/lib/apollo/client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await listApolloOrganizationCandidates(supabaseAdmin, companyId);
    return NextResponse.json({
      current: result.current
        ? {
            apollo_organization_id: result.current.apollo_organization_id,
            apollo_organization_name: result.current.name,
            domain:
              result.current.primary_domain ??
              result.current.website?.replace(/^https?:\/\//i, "").split("/")[0] ??
              null,
            match_confidence: result.current.match_confidence,
          }
        : null,
      candidates: result.candidates.map((c) => ({
        apollo_organization_id: c.apollo_organization_id,
        name: c.name,
        website: c.website,
        industry: c.industry,
        description: c.description,
        score: c.score,
        primary_domain: c.primary_domain,
        match_confidence: c.match_confidence,
        selected: c.selected,
      })),
      company_name: result.company_name,
      product_category: result.product_category,
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Failed to load organization candidates";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
