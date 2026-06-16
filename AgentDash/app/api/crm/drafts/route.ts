import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { fetchPipelineCardsForUser } from "@/lib/features/crm-pipeline/service";
import { chunkArray } from "@/lib/import/chunk";
import { NextResponse } from "next/server";

/** PostgREST `.in()` on company_id blows URL limits when many pipeline cards exist. */
const CONTACT_COMPANY_IN_CHUNK = 200;

export type ContactDraftListItem = {
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  company_id: string;
  company_name: string;
  pipeline_id: string | null;
  draft: {
    label?: string;
    subject?: string;
    body: string;
    created_at: string;
    athlete_id?: string | null;
  };
};

export async function GET() {
  const profile = await requireProfile();
  const supabase = await createServerClient();

  let cards: any[] = [];
  try {
    cards = await fetchPipelineCardsForUser(supabase, profile.user_id);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load pipeline cards";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const companyIdToPipelineId = new Map<string, string>();
  for (const c of cards) {
    const cid = String((c as { company_id?: string }).company_id ?? "");
    if (cid && !companyIdToPipelineId.has(cid)) {
      companyIdToPipelineId.set(cid, String((c as { id?: string }).id ?? ""));
    }
  }

  const companyIds = [...companyIdToPipelineId.keys()];
  const contact_drafts: ContactDraftListItem[] = [];

  const contactSelect =
    "contact_id, company_id, first_name, last_name, email, email_drafts, companies(name)" as const;

  let contactRows: Record<string, unknown>[] = [];

  if (companyIds.length > 0) {
    for (const companyIdBatch of chunkArray(companyIds, CONTACT_COMPANY_IN_CHUNK)) {
      let contactQuery = supabase.from("crm_contacts").select(contactSelect).in("company_id", companyIdBatch);

      if (profile.role === "agent") {
        contactQuery = contactQuery.eq("created_by_user_id", profile.user_id);
      }

      const { data, error: cErr } = await contactQuery;
      if (cErr) {
        return NextResponse.json({ error: cErr.message }, { status: 500 });
      }
      if (data?.length) {
        contactRows.push(...(data as Record<string, unknown>[]));
      }
    }
  } else if (profile.role === "agent") {
    const { data, error: cErr } = await supabase
      .from("crm_contacts")
      .select(contactSelect)
      .eq("created_by_user_id", profile.user_id)
      .order("updated_at", { ascending: false })
      .limit(400);
    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 });
    }
    contactRows = (data ?? []) as Record<string, unknown>[];
  }

  if (contactRows.length > 0) {
    for (const row of contactRows) {
      const r = row as unknown as {
        contact_id: string;
        company_id: string;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
        email_drafts?: unknown;
        companies?: { name?: string | null } | null;
      };
      const drafts = Array.isArray(r.email_drafts) ? r.email_drafts : [];
      const companyName =
        r.companies && typeof r.companies === "object" && r.companies != null && "name" in r.companies
          ? String(r.companies.name ?? "")
          : "";
      const contactName =
        [r.first_name, r.last_name]
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
          .join(" ")
          .trim() || String(r.email ?? "").trim() || "Contact";

      for (const raw of drafts) {
        if (!raw || typeof raw !== "object") continue;
        const d = raw as Record<string, unknown>;
        const body = String(d.body ?? "");
        const created_at = String(d.created_at ?? "");
        if (!body || !created_at) continue;
        contact_drafts.push({
          contact_id: String(r.contact_id),
          contact_name: contactName,
          contact_email: r.email?.trim() ? String(r.email) : null,
          company_id: String(r.company_id),
          company_name: companyName,
          pipeline_id: companyIdToPipelineId.get(String(r.company_id)) ?? null,
          draft: {
            label: d.label != null ? String(d.label) : undefined,
            subject: d.subject != null ? String(d.subject) : undefined,
            body,
            created_at,
            athlete_id: d.athlete_id != null ? String(d.athlete_id) : null,
          },
        });
      }
    }
  }

  contact_drafts.sort((a, b) => new Date(b.draft.created_at).getTime() - new Date(a.draft.created_at).getTime());

  return NextResponse.json({ cards, contact_drafts });
}
