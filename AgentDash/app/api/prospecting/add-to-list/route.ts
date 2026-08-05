import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { getAccessibleAthleteIds } from "@/lib/athletes/accessible";
import { mergeAthleteIntoPotentialAthletes } from "@/lib/crm/potential-athletes";
import { upsertApolloPendingContacts } from "@/lib/apollo/sync-contacts";
import { isApolloEnabled } from "@/lib/apollo/config";
import { persistApolloMetadataForCompany } from "@/lib/apollo/persist-company";
import type { ApolloSearchPerson } from "@/lib/apollo/types";
import { NextResponse } from "next/server";

const MAX_ITEMS = 25;

type AddCompanyItem = {
  type: "company";
  company_name: string;
  website?: string | null;
  apollo_organization_id?: string | null;
  industry?: string | null;
};

type AddPersonItem = {
  type: "person";
  company_name: string;
  website?: string | null;
  apollo_organization_id?: string | null;
  industry?: string | null;
  person: {
    apollo_person_id: string;
    first_name: string;
    last_name: string;
    title?: string;
    linkedin_url?: string;
    has_email?: boolean;
    email_status?: string;
  };
};

type AddItem = AddCompanyItem | AddPersonItem;

async function getOrCreateCompany(
  supabaseAdmin: Awaited<ReturnType<typeof createServiceRoleClient>>,
  opts: {
    name: string;
    website?: string | null;
    apollo_organization_id?: string | null;
    industry?: string | null;
    userId: string;
  }
): Promise<string> {
  const name = opts.name.trim();
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("companies")
    .select("company_id, website, apollo_organization_id")
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let companyId = existing?.company_id as string | undefined;
  if (!companyId) {
    const insert: Record<string, unknown> = {
      name,
      industry: opts.industry ?? null,
      website: opts.website ?? null,
    };
    if (opts.apollo_organization_id) {
      insert.apollo_organization_id = opts.apollo_organization_id;
    }
    const { data: created, error: createdError } = await supabaseAdmin
      .from("companies")
      .insert(insert)
      .select("company_id")
      .single();
    if (createdError) throw new Error(createdError.message);
    companyId = created.company_id;
  } else {
    const patch: Record<string, unknown> = {};
    if (!existing?.website && opts.website) patch.website = opts.website;
    if (!existing?.apollo_organization_id && opts.apollo_organization_id) {
      patch.apollo_organization_id = opts.apollo_organization_id;
    }
    if (opts.industry) patch.industry = opts.industry;
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("companies").update(patch).eq("company_id", companyId);
    }
  }

  if (isApolloEnabled() && opts.website) {
    try {
      await persistApolloMetadataForCompany(supabaseAdmin, companyId!, {
        website: opts.website,
      });
    } catch {
      // non-fatal
    }
  }

  return companyId!;
}

/**
 * POST /api/prospecting/add-to-list
 * Body: { athlete_id, items: AddItem[] }
 */
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();
  const body = await req.json().catch(() => ({}));

  const athleteId = String(body.athlete_id ?? "").trim();
  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  if (!athleteId) {
    return NextResponse.json({ error: "athlete_id is required" }, { status: 400 });
  }
  if (itemsRaw.length === 0 || itemsRaw.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `items must be a non-empty array of at most ${MAX_ITEMS}` },
      { status: 400 }
    );
  }

  let accessible: string[];
  try {
    accessible = await getAccessibleAthleteIds(supabase, profile);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to resolve athletes" },
      { status: 500 }
    );
  }
  if (!accessible.includes(athleteId)) {
    return NextResponse.json({ error: "Unauthorized for this athlete" }, { status: 403 });
  }

  const { data: athlete, error: athleteErr } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (athleteErr || !athlete) {
    return NextResponse.json({ error: athleteErr?.message ?? "Athlete not found" }, { status: 404 });
  }

  const athleteEntry = {
    athlete_id: athleteId,
    name: [athlete.first_name, athlete.last_name].filter(Boolean).join(" ").trim() || "Unknown",
    sport: athlete.sport != null ? String(athlete.sport) : null,
  };

  const results: Array<{
    index: number;
    status: "added" | "already_on_list" | "error";
    company_id?: string;
    pipeline_id?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < itemsRaw.length; i++) {
    const raw = itemsRaw[i] as Partial<AddItem>;
    try {
      const type = raw.type === "person" ? "person" : "company";
      const companyName = String(
        (raw as AddCompanyItem).company_name ?? ""
      ).trim();
      if (!companyName) {
        results.push({ index: i, status: "error", error: "company_name required" });
        continue;
      }

      const website =
        (raw as AddCompanyItem).website != null
          ? String((raw as AddCompanyItem).website).trim() || null
          : null;
      const apolloOrgId =
        (raw as AddCompanyItem).apollo_organization_id != null
          ? String((raw as AddCompanyItem).apollo_organization_id).trim() || null
          : null;
      const industry =
        (raw as AddCompanyItem).industry != null
          ? String((raw as AddCompanyItem).industry).trim() || null
          : null;

      const companyId = await getOrCreateCompany(supabaseAdmin, {
        name: companyName,
        website,
        apollo_organization_id: apolloOrgId,
        industry,
        userId: profile.user_id,
      });

      const { data: existingPipeline } = await supabase
        .from("crm_companies_pipeline")
        .select("id, potential_athletes, archived")
        .eq("company_id", companyId)
        .eq("created_by_user_id", profile.user_id)
        .maybeSingle();

      let pipelineId: string;
      let alreadyLinked = false;

      if (existingPipeline) {
        const { next, alreadyLinked: linked } = mergeAthleteIntoPotentialAthletes(
          existingPipeline.potential_athletes,
          athleteEntry
        );
        alreadyLinked = linked;
        const { data: updated, error: updateErr } = await supabase
          .from("crm_companies_pipeline")
          .update({
            potential_athletes: next,
            archived: false,
            status: "in_progress",
          })
          .eq("id", existingPipeline.id)
          .select("id")
          .single();
        if (updateErr) throw new Error(updateErr.message);
        pipelineId = String(updated.id);
      } else {
        const { data: created, error: createErr } = await supabase
          .from("crm_companies_pipeline")
          .insert({
            company_id: companyId,
            created_by_user_id: profile.user_id,
            status: "in_progress",
            pipeline_stage: "target",
            funnel_stage: "idea",
            potential_athletes: [athleteEntry],
            archived: false,
          })
          .select("id")
          .single();
        if (createErr) throw new Error(createErr.message);
        pipelineId = String(created.id);
      }

      if (type === "person") {
        const personRaw = (raw as AddPersonItem).person;
        const apolloPersonId = String(personRaw?.apollo_person_id ?? "").trim();
        const firstName = String(personRaw?.first_name ?? "").trim();
        if (apolloPersonId && firstName) {
          const person: ApolloSearchPerson = {
            apollo_person_id: apolloPersonId,
            first_name: firstName,
            last_name: String(personRaw?.last_name ?? "").trim(),
            title: String(personRaw?.title ?? "").trim(),
            organization_name: companyName,
            linkedin_url: personRaw?.linkedin_url
              ? String(personRaw.linkedin_url).trim()
              : undefined,
            has_email: personRaw?.has_email === true,
            email_status: personRaw?.email_status
              ? String(personRaw.email_status)
              : undefined,
          };
          await upsertApolloPendingContacts(supabaseAdmin, {
            userId: profile.user_id,
            companyId,
            people: [person],
          });
        }
      }

      results.push({
        index: i,
        status: alreadyLinked ? "already_on_list" : "added",
        company_id: companyId,
        pipeline_id: pipelineId,
      });
    } catch (e) {
      results.push({
        index: i,
        status: "error",
        error: e instanceof Error ? e.message : "Failed to add",
      });
    }
  }

  const added = results.filter((r) => r.status === "added").length;
  const already = results.filter((r) => r.status === "already_on_list").length;
  const failed = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    ok: true,
    athlete_id: athleteId,
    athlete_name: athleteEntry.name,
    added,
    already_on_list: already,
    failed,
    results,
  });
}
