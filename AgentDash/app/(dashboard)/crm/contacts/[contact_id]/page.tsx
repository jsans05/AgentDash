import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CrmContactEditor, type CrmContactEmailDraft } from "@/components/crm/CrmContactEditor";

export default async function EditCrmContactPage({
  params,
}: {
  params: Promise<{ contact_id: string }>;
}) {
  const { contact_id } = await params;
  await requireProfile();
  const supabase = await createServerClient();

  const { data: contact, error: contactError } = await supabase
    .from("crm_contacts")
    .select(
      `
        *,
        companies(name)
      `
    )
    .eq("contact_id", contact_id)
    .single();

  if (contactError) return notFound();
  if (!contact) return notFound();

  const companyName =
    contact.companies?.name ??
    (Array.isArray(contact.companies) ? contact.companies?.[0]?.name : null) ??
    "";

  const { data: linkedRows } = await supabase
    .from("crm_contact_athletes")
    .select("athlete_id")
    .eq("contact_id", contact_id);

  const selectedAthleteIds = (linkedRows ?? []).map((r: any) => r.athlete_id);

  const { data: initialLogsRaw } = await supabase
    .from("crm_outreach_logs")
    .select(
      `
        id,
        contact_id,
        athlete_id,
        outreach_channel,
        outreach_at,
        outreach_notes,
        athletes:athlete_id (athlete_id, first_name, last_name, sport)
      `
    )
    .eq("contact_id", contact_id)
    .order("outreach_at", { ascending: false })
    .limit(50);

  const initialLogs = (initialLogsRaw ?? []).map((l: any) => {
    const a = l.athletes && Array.isArray(l.athletes) ? l.athletes[0] : l.athletes;
    return {
      id: l.id,
      outreach_channel: l.outreach_channel,
      outreach_at: l.outreach_at,
      outreach_notes: l.outreach_notes,
      athlete_id: l.athlete_id,
      athletes: a
        ? {
            first_name: a.first_name,
            last_name: a.last_name,
            sport: a.sport,
          }
        : null,
    };
  });

  const { data: taxonomyNodes } = await supabase
    .from("sponsorship_taxonomies")
    .select("id, sport, tier, category, sort_order")
    .eq("is_active", true)
    .order("sport", { ascending: true })
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  const { data: athleteOptions } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, country")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <Link href="/crm/contacts" className="text-sm text-[#CEE4D4] hover:underline">
            ← Back to Contacts
          </Link>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0F1311] p-4 sm:p-6">
          <CrmContactEditor
            mode="edit"
            contactId={contact_id}
            initial={{
              company_name: companyName,
              first_name: contact.first_name,
              last_name: contact.last_name,
              role: contact.role ?? "",
              email: contact.email ?? "",
              phone: contact.phone ?? "",
              linkedin_url: contact.linkedin_url ?? "",
              zoominfo_url: contact.zoominfo_url ?? "",
              taxonomy_id: contact.taxonomy_id ?? null,
              product_description: contact.product_description ?? "",
              notes: contact.notes ?? "",
              selectedAthleteIds,
              last_outreach_at: contact.last_outreach_at ?? null,
              status_tag: contact.status_tag ?? "none",
              archived: Boolean(contact.archived),
              outreach_mode: contact.outreach_mode ?? "email",
              email_drafts: Array.isArray((contact as { email_drafts?: unknown }).email_drafts)
                ? ((contact as { email_drafts: unknown[] }).email_drafts as CrmContactEmailDraft[])
                : [],
            }}
            taxonomyNodes={(taxonomyNodes ?? []) as any}
            athleteOptions={(athleteOptions ?? []) as any}
            initialLogs={initialLogs}
          />
        </div>
      </div>
    </div>
  );
}

