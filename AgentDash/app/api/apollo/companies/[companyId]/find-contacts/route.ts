import { NextResponse } from "next/server";
import { requireNonAccounting } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled } from "@/lib/apollo/config";
import { findContactsForCompany } from "@/lib/apollo/find-company-contacts";
import { ApolloApiError } from "@/lib/apollo/client";
import { parseContactSearchOverridesFromBody } from "@/lib/apollo/contact-search-api-body";
import {
  apolloContactOverridesToPeopleSearch,
  type ApolloContactSearchMode,
} from "@/lib/apollo/search-defaults";

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

  const overrides = apolloContactOverridesToPeopleSearch(
    parseContactSearchOverridesFromBody(body as Record<string, unknown>)
  );

  const searchMode: ApolloContactSearchMode =
    body.search_mode === "all_verified" ? "all_verified" : "partnership";

  const consultingProfileId =
    body.consulting_profile_id != null ? String(body.consulting_profile_id).trim() || null : null;

  const supabaseAdmin = await createServiceRoleClient();

  if (consultingProfileId) {
    const { requireConsultingProfileAccess } = await import("@/lib/consulting/access");
    await requireConsultingProfileAccess(supabaseAdmin, profile, consultingProfileId);
  }

  try {
    const result = await findContactsForCompany(supabaseAdmin, {
      userId: profile.user_id,
      companyId,
      overrides,
      searchMode,
      consultingProfileId,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Apollo search failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
