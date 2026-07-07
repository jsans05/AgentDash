import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { isApolloEnabled } from "@/lib/apollo/config";
import { selectApolloOrganization } from "@/lib/apollo/resolve-organization";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ApolloApiError } from "@/lib/apollo/client";

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
  const apollo_organization_id = String(body.apollo_organization_id ?? "").trim();
  if (!apollo_organization_id) {
    return NextResponse.json({ error: "apollo_organization_id is required" }, { status: 400 });
  }

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await selectApolloOrganization(supabaseAdmin, {
      companyId,
      apollo_organization_id,
      userId: profile.user_id,
    });
    return NextResponse.json({
      organization: {
        apollo_organization_id: result.apollo_organization_id,
        apollo_organization_name: result.apollo_organization_name,
        domain: result.domain,
        match_confidence: result.match_confidence,
        match_notes: result.match_notes,
      },
      pending_contacts_cleared: result.pending_contacts_cleared,
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Failed to select organization";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
