import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isApolloEnabled, isApolloPhoneRevealAllowed } from "@/lib/apollo/config";
import { resolveOrganizationForCompany } from "@/lib/apollo/resolve-organization";
import { requestPersonPhoneReveal } from "@/lib/apollo/people-phone-reveal";
import { buildApolloPhoneWebhookUrl } from "@/lib/apollo/webhook-url";
import { logApolloUsage } from "@/lib/apollo/usage";
import { ApolloApiError } from "@/lib/apollo/client";

export async function POST(req: Request) {
  const profile = await requireProfile();
  if (!isApolloEnabled()) {
    return NextResponse.json({ error: "Apollo API is not configured" }, { status: 503 });
  }
  if (!isApolloPhoneRevealAllowed()) {
    return NextResponse.json({ error: "Apollo phone reveal is disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const contact_id = String(body.contact_id ?? "").trim();
  if (!contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }

  const webhookUrl = buildApolloPhoneWebhookUrl(contact_id);
  if (!webhookUrl) {
    return NextResponse.json(
      {
        error:
          "Phone reveal requires APOLLO_WEBHOOK_BASE_URL (public HTTPS app URL) to receive Apollo callbacks",
      },
      { status: 503 }
    );
  }

  const supabase = await createServerClient();
  const { data: contact, error: loadErr } = await supabase
    .from("crm_contacts")
    .select(
      "contact_id, company_id, created_by_user_id, first_name, last_name, role, email, phone, linkedin_url, apollo_person_id, apollo_phone_reveal_status, companies(name, website)"
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
  if (contact.phone && contact.apollo_phone_reveal_status === "revealed") {
    return NextResponse.json({
      contact: {
        contact_id: contact.contact_id,
        phone: contact.phone,
        apollo_phone_reveal_status: "revealed",
      },
      already_revealed: true,
    });
  }
  if (contact.apollo_phone_reveal_status === "pending") {
    return NextResponse.json({
      contact: {
        contact_id: contact.contact_id,
        phone: contact.phone,
        apollo_phone_reveal_status: "pending",
      },
      already_pending: true,
    });
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
    const { work_phone } = await requestPersonPhoneReveal({
      apollo_person_id: String(contact.apollo_person_id),
      first_name: contact.first_name,
      last_name: contact.last_name !== "—" ? contact.last_name : undefined,
      organization_name: companyName,
      domain,
      linkedin_url: contact.linkedin_url,
      email: contact.email,
      webhook_url: webhookUrl,
    });

    await logApolloUsage(supabaseAdmin, {
      user_id: profile.user_id,
      endpoint: "people/match",
      company_id: contact.company_id,
      apollo_person_id: contact.apollo_person_id,
    });

    await supabaseAdmin.from("apollo_phone_reveal_requests").insert({
      contact_id,
      apollo_person_id: contact.apollo_person_id,
      user_id: profile.user_id,
      status: "pending",
    });

    const patch: Record<string, unknown> = {
      apollo_phone_reveal_status: "pending",
    };
    if (work_phone && !contact.phone) {
      patch.phone = work_phone;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("crm_contacts")
      .update(patch)
      .eq("contact_id", contact_id)
      .select("contact_id, phone, apollo_phone_reveal_status")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      contact: updated,
      work_phone,
      async: true,
      message:
        "Personal/mobile numbers are delivered asynchronously (usually within a few minutes) once Apollo verifies them.",
    });
  } catch (e) {
    if (e instanceof ApolloApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    const msg = e instanceof Error ? e.message : "Phone reveal failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
