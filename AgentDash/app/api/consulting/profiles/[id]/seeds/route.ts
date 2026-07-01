import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireConsultingProfileAdmin, ConsultingAccessError } from "@/lib/consulting/access";
import { getOrCreateCompanyByName } from "@/lib/consulting/companies";
import { isApolloEnabled } from "@/lib/apollo/config";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import { resolveCompanyWebsiteForTargetList } from "@/lib/crm/resolve-company-website-for-target-list";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  const { id: profileId } = await params;

  try {
    await requireConsultingProfileAdmin(profile);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const companyName = String(body.company_name ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "company_name required" }, { status: 400 });
  }

  const label = body.label != null ? String(body.label).trim() || null : null;
  const companyIdFromBody = body.company_id != null ? String(body.company_id).trim() : "";

  const supabaseAdmin = await createServiceRoleClient();
  const companyId = companyIdFromBody || (await getOrCreateCompanyByName(supabaseAdmin, companyName));

  const websiteHint = body.website != null ? String(body.website).trim() || null : null;
  try {
    await resolveCompanyWebsiteForTargetList(
      supabaseAdmin,
      companyId,
      { companyName, websiteHint },
      { userId: profile.user_id }
    );
  } catch {
    // non-fatal
  }
  if (isApolloEnabled() && websiteHint) {
    try {
      await persistApolloMetadataForCompany(supabaseAdmin, companyId, { website: websiteHint });
    } catch {
      // non-fatal
    }
  }

  const { data, error } = await supabaseAdmin
    .from("consulting_profile_seeds")
    .upsert(
      { profile_id: profileId, company_id: companyId, label },
      { onConflict: "profile_id,company_id" }
    )
    .select("id, company_id, label, companies(name, website)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ seed: data });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const profile = await requireProfile();
  const { id: profileId } = await params;

  try {
    await requireConsultingProfileAdmin(profile);
  } catch (e) {
    if (e instanceof ConsultingAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const seedId = String(body.seed_id ?? "").trim();
  if (!seedId) {
    return NextResponse.json({ error: "seed_id required" }, { status: 400 });
  }

  const supabaseAdmin = await createServiceRoleClient();
  const { error } = await supabaseAdmin
    .from("consulting_profile_seeds")
    .delete()
    .eq("id", seedId)
    .eq("profile_id", profileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
