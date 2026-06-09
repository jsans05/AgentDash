import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEmailRevealAllowed, isApolloEnabled } from "@/lib/apollo/config";
import { matchPerson } from "@/lib/apollo/people-match";
import { resolveOrganizationForCompany } from "@/lib/apollo/resolve-organization";
import { logApolloUsage } from "@/lib/apollo/usage";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }
  if (!isApolloEmailRevealAllowed()) {
    return NextResponse.json({ error: "Apollo email reveal is disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const contact_id = String(body.contact_id ?? "").trim();
  if (!contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: contact, error: loadErr } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, company_id, created_by_user_id, first_name, last_name, role, email, linkedin_url, apollo_person_id, apollo_reveal_status, companies(name, website)"
    )
    .eq("contact_id", contact_id)
    .single();

  if (loadErr || !contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (contact.created_by_user_id !== profile.user_id && profile.role !== "admin" && profile.role !== "sales") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!contact.apollo_person_id) {
    return NextResponse.json({ error: "Contact is not an Apollo candidate" }, { status: 400 });
  }

  const company = Array.isArray(contact.companies) ? contact.companies[0] : contact.companies;
  const companyName = String(company?.name ?? "").trim();

  const supabaseAdmin = await createServiceRoleClient();
  let domain: string | null = null;
  try {
    const org = await resolveOrganizationForCompany(supabaseAdmin, contact.company_id);
    domain = org.domain;
  } catch {
    domain = null;
  }

  try {
    const matched = await matchPerson({
      apollo_person_id: String(contact.apollo_person_id),
      first_name: contact.first_name,
      last_name: contact.last_name !== "—" ? contact.last_name : undefined,
      organization_name: companyName,
      domain,
      linkedin_url: contact.linkedin_url,
    });

    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "people/match",
      company_id: contact.company_id,
      apollo_person_id: contact.apollo_person_id,
    });

    const patch: Record<string, unknown> = {
      apollo_reveal_status: "revealed",
    };
    if (matched.email) patch.email = matched.email.toLowerCase();
    if (matched.linkedin_url) patch.linkedin_url = matched.linkedin_url;
    if (matched.first_name) patch.first_name = matched.first_name;
    if (matched.last_name && matched.last_name !== "—") patch.last_name = matched.last_name;
    if (matched.title) patch.role = matched.title;

    const { data: updated, error: updateErr } = await supabase
      .from("crm_contacts")
      .update(patch)
      .eq("contact_id", contact_id)
      .select(
        "contact_id, first_name, last_name, role, email, linkedin_url, apollo_person_id, apollo_reveal_status"
      )
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ contact: updated, matched });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Apollo match failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
