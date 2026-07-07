import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { fetchCompanyRecentNews } from "@/lib/apollo/company-recent-news";
import { ApolloApiError } from "@/lib/apollo/client";
import { isApolloEnabled } from "@/lib/apollo/config";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const profile = await requireNonAccounting();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }

  const { companyId } = await params;
  const supabaseAdmin = await createServiceRoleClient();

  try {
    const result = await fetchCompanyRecentNews(supabaseAdmin, {
      companyId,
      userId: profile.user_id,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Recent news fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
