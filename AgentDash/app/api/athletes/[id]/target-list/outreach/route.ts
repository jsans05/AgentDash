import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { curatePitchInterests } from "@/lib/ai/pitch-interest-curation";
import { composePitchEmail } from "@/lib/ai/pitch-composer";
import { upsertContactOutreachDraft } from "@/lib/crm/target-list-outreach";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";

type PipelineRow = {
  id: string;
  company_id: string;
  potential_athletes: Array<{ athlete_id?: string }> | null;
  company_description: string | null;
  past_partnerships: string | null;
  personal_notes: string | null;
  companies:
    | {
        name: string | null;
        product_category: string | null;
      }
    | Array<{
        name: string | null;
        product_category: string | null;
      }>
    | null;
};

type ContactRow = {
  contact_id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  notes: string | null;
  email_drafts: unknown;
};

type GeneratedEntry = {
  pipeline_id: string;
  company_name: string;
  outreach_email_subject: string;
  outreach_email: string;
  contact_id?: string;
  used_interests?: string[];
};

function pickCompany(
  value: PipelineRow["companies"]
): { name: string | null; product_category: string | null } | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function recipientFirstName(contact: ContactRow | null, fallback: string): string {
  if (contact) {
    const first = String(contact.first_name ?? "").trim();
    if (first) return first;
    const full = formatContactDisplayName(
      String(contact.first_name ?? ""),
      String(contact.last_name ?? "")
    );
    if (full) return full.split(/\s+/)[0] ?? full;
  }
  const trimmed = String(fallback ?? "").trim();
  return trimmed || "[Recipient Name]";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const supabase = await createServerClient();
  const { id: athleteId } = await params;
  const body = await req.json().catch(() => ({}));
  const onlyPipelineId = String(body.pipeline_id ?? "").trim() || null;
  const onlyContactId = String(body.contact_id ?? "").trim() || null;
  const recipientNameOverride = String(body.recipient_name ?? "").trim() || null;

  if (profile.role === "agent") {
    const { data: link } = await supabase
      .from("athlete_agents")
      .select("user_id")
      .eq("athlete_id", athleteId)
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (!link) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: athlete } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport, accolades")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (!athlete) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });

  let pipelineQuery = supabase
    .from("crm_companies_pipeline")
    .select(
      "id, company_id, potential_athletes, company_description, past_partnerships, personal_notes, companies(name, product_category)"
    )
    .eq("created_by_user_id", profile.user_id)
    .eq("archived", false);
  if (onlyPipelineId) {
    pipelineQuery = pipelineQuery.eq("id", onlyPipelineId);
  }

  const { data: rowsRaw, error: rowsError } = await pipelineQuery;
  if (rowsError) return NextResponse.json({ error: rowsError.message }, { status: 500 });

  const rows = (rowsRaw ?? []).filter((row: any) => {
    const potential = Array.isArray(row.potential_athletes) ? row.potential_athletes : [];
    return potential.some((entry: any) => String(entry?.athlete_id ?? "") === athleteId);
  }) as PipelineRow[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, updated: 0, skipped: 0, errors: [], generated: [] });
  }

  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
  const contactsByCompany = new Map<string, ContactRow[]>();

  if (companyIds.length > 0) {
    const { data: contactRows, error: contactErr } = await supabase
      .from("crm_contacts")
      .select("contact_id, company_id, first_name, last_name, notes, email_drafts")
      .in("company_id", companyIds)
      .eq("created_by_user_id", profile.user_id)
      .eq("archived", false);
    if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
    for (const c of contactRows ?? []) {
      const list = contactsByCompany.get(c.company_id) ?? [];
      list.push(c as ContactRow);
      contactsByCompany.set(c.company_id, list);
    }
  }

  const errors: Array<{ pipeline_id: string; company_name: string; error: string; contact_id?: string }> = [];
  const generated: GeneratedEntry[] = [];
  let updated = 0;
  let skipped = 0;

  async function generateAndPersist(
    row: PipelineRow,
    companyName: string,
    contact: ContactRow | null
  ): Promise<boolean> {
    const category = pickCompany(row.companies)?.product_category ?? null;
    const recipient_name = recipientFirstName(
      contact,
      recipientNameOverride ?? "[Recipient Name]"
    );
    const personal_notes = contact
      ? contact.notes ?? null
      : row.personal_notes ?? null;

    const curation = await curatePitchInterests({
      supabase,
      profile,
      pitch_type: "single_athlete",
      company_name: companyName,
      target_industry_or_category: category,
      athlete_id: athleteId,
    });
    const interest_names = curation.suggested_interests.map((s) => s.interest_name);
    const composed = await composePitchEmail({
      supabase,
      profile,
      pitch_type: "single_athlete",
      company_name: companyName,
      interest_names: interest_names.length ? interest_names : curation.mapped_valid_categories.slice(0, 3),
      recipient_name,
      athlete_id: athleteId,
      target_industry_or_category: category,
      past_partnerships: row.past_partnerships,
      company_description: row.company_description,
      personal_notes,
    });

    if (contact) {
      const nextDrafts = upsertContactOutreachDraft(
        contact.email_drafts,
        athleteId,
        composed.subject,
        composed.body
      );
      const { error: updateError } = await supabase
        .from("crm_contacts")
        .update({ email_drafts: nextDrafts })
        .eq("contact_id", contact.contact_id)
        .eq("created_by_user_id", profile.user_id);
      if (updateError) {
        errors.push({
          pipeline_id: row.id,
          company_name: companyName,
          contact_id: contact.contact_id,
          error: updateError.message,
        });
        return false;
      }
      generated.push({
        pipeline_id: row.id,
        company_name: companyName,
        contact_id: contact.contact_id,
        outreach_email_subject: composed.subject,
        outreach_email: composed.body,
        used_interests: composed.used_interests,
      });
      return true;
    }

    const { error: updateError } = await supabase
      .from("crm_companies_pipeline")
      .update({
        outreach_email_subject: composed.subject,
        outreach_email: composed.body,
      })
      .eq("id", row.id)
      .eq("created_by_user_id", profile.user_id);
    if (updateError) {
      errors.push({ pipeline_id: row.id, company_name: companyName, error: updateError.message });
      return false;
    }
    generated.push({
      pipeline_id: row.id,
      company_name: companyName,
      outreach_email_subject: composed.subject,
      outreach_email: composed.body,
      used_interests: composed.used_interests,
    });
    return true;
  }

  for (const row of rows) {
    const company = pickCompany(row.companies);
    const companyName = String(company?.name ?? "").trim();
    if (!companyName) {
      skipped += 1;
      errors.push({ pipeline_id: row.id, company_name: "", error: "Missing company name" });
      continue;
    }

    const companyContacts = contactsByCompany.get(row.company_id) ?? [];
    let targets: (ContactRow | null)[] = [];

    if (onlyContactId) {
      const match = companyContacts.find((c) => c.contact_id === onlyContactId);
      if (!match) {
        skipped += 1;
        errors.push({
          pipeline_id: row.id,
          company_name: companyName,
          contact_id: onlyContactId,
          error: "Contact not found for this company",
        });
        continue;
      }
      targets = [match];
    } else if (onlyPipelineId) {
      targets = [null];
    } else if (companyContacts.length > 0) {
      targets = companyContacts;
    } else {
      targets = [null];
    }

    for (const contact of targets) {
      try {
        const ok = await generateAndPersist(row, companyName, contact);
        if (ok) updated += 1;
      } catch (e) {
        errors.push({
          pipeline_id: row.id,
          company_name: companyName,
          contact_id: contact?.contact_id,
          error: e instanceof Error ? e.message : "Failed to compose outreach email",
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    updated,
    skipped,
    errors,
    generated,
  });
}
