import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parsePhoneFromWebhookPayload } from "@/lib/apollo/people-phone-reveal";
import { isValidApolloWebhookToken } from "@/lib/apollo/webhook-url";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!isValidApolloWebhookToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactIdFromUrl = url.searchParams.get("contact_id")?.trim() || null;
  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabaseAdmin = await createServiceRoleClient();

  let contactId = contactIdFromUrl;
  let apolloPersonId: string | null = null;

  if (!contactId) {
    const people = Array.isArray((payload as { people?: unknown }).people)
      ? ((payload as { people: Array<{ id?: string }> }).people)
      : [];
    apolloPersonId = people[0]?.id != null ? String(people[0].id) : null;
    if (!apolloPersonId) {
      return NextResponse.json({ ok: true, skipped: true, reason: "no_person_id" });
    }

    const { data: pending } = await supabaseAdmin
      .from("apollo_phone_reveal_requests")
      .select("contact_id, apollo_person_id")
      .eq("apollo_person_id", apolloPersonId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    contactId = pending?.contact_id ?? null;
    apolloPersonId = pending?.apollo_person_id ?? apolloPersonId;
  } else {
    const { data: contact } = await supabaseAdmin
      .from("crm_contacts")
      .select("apollo_person_id")
      .eq("contact_id", contactId)
      .maybeSingle();
    apolloPersonId = contact?.apollo_person_id != null ? String(contact.apollo_person_id) : null;
  }

  if (!contactId || !apolloPersonId) {
    return NextResponse.json({ ok: true, skipped: true, reason: "contact_not_found" });
  }

  const phone = parsePhoneFromWebhookPayload(payload, apolloPersonId);
  const now = new Date().toISOString();

  if (phone) {
    await supabaseAdmin
      .from("crm_contacts")
      .update({
        phone,
        apollo_phone_reveal_status: "revealed",
      })
      .eq("contact_id", contactId);

    await supabaseAdmin
      .from("apollo_phone_reveal_requests")
      .update({ status: "delivered", phone, delivered_at: now })
      .eq("contact_id", contactId)
      .eq("status", "pending");
  } else {
    await supabaseAdmin
      .from("apollo_phone_reveal_requests")
      .update({ status: "no_phone", delivered_at: now })
      .eq("contact_id", contactId)
      .eq("status", "pending");

    await supabaseAdmin
      .from("crm_contacts")
      .update({ apollo_phone_reveal_status: null })
      .eq("contact_id", contactId)
      .eq("apollo_phone_reveal_status", "pending");
  }

  return NextResponse.json({ ok: true, contact_id: contactId, phone });
}
