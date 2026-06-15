import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { enrichCompanyHqPhone } from "@/lib/apollo/enrich-company-hq-phone";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const body = await req.json().catch(() => ({}));
  const overwrite = body.overwrite === true;

  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await enrichCompanyHqPhone(supabaseAdmin, {
      userId: profile.user_id,
      companyId,
      overwrite,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "HQ phone enrichment failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
