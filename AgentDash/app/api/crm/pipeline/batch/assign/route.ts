import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_BATCH_SIZE = 50;

function parsePipelineIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { pipeline_ids?: unknown }).pipeline_ids;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ids = [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_BATCH_SIZE) return null;
  return ids;
}

/**
 * POST /api/crm/pipeline/batch/assign
 *
 * Transfer pipeline cards to a teammate. Cards leave the caller's board and
 * land on the assignee's pipeline at Target stage. Research context carries over.
 */
export async function POST(req: Request) {
  const profile = await requireNonAccounting();
  const supabase = await createServerClient();
  const supabaseAdmin = await createServiceRoleClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pipelineIds = parsePipelineIds(body);
  const assigneeUserId = String(
    (body as { assignee_user_id?: unknown })?.assignee_user_id ?? ""
  ).trim();

  if (!pipelineIds) {
    return NextResponse.json(
      { error: `pipeline_ids must be a non-empty array of at most ${MAX_BATCH_SIZE} ids` },
      { status: 400 }
    );
  }
  if (!assigneeUserId) {
    return NextResponse.json({ error: "assignee_user_id is required" }, { status: 400 });
  }
  if (assigneeUserId === profile.user_id) {
    return NextResponse.json({ error: "Cannot assign cards to yourself" }, { status: 400 });
  }

  const { data: assignee, error: assigneeErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, role, first_name, last_name, email")
    .eq("user_id", assigneeUserId)
    .maybeSingle();

  if (assigneeErr) {
    return NextResponse.json({ error: assigneeErr.message }, { status: 500 });
  }
  if (!assignee) {
    return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
  }
  if (assignee.role === "accounting" || assignee.role === "operations") {
    return NextResponse.json(
      { error: "Cannot assign pipeline cards to accounting or operations users" },
      { status: 400 }
    );
  }

  const { data: ownedCards, error: ownedErr } = await supabase
    .from("crm_companies_pipeline")
    .select("id, company_id")
    .in("id", pipelineIds)
    .eq("created_by_user_id", profile.user_id)
    .eq("archived", false);

  if (ownedErr) {
    return NextResponse.json({ error: ownedErr.message }, { status: 500 });
  }

  const owned = ownedCards ?? [];
  if (owned.length === 0) {
    return NextResponse.json({ error: "No matching owned cards found" }, { status: 404 });
  }

  const companyIds = owned.map((c) => String(c.company_id));
  const { data: existingAssigneeCards, error: existingErr } = await supabaseAdmin
    .from("crm_companies_pipeline")
    .select("id, company_id")
    .eq("created_by_user_id", assigneeUserId)
    .in("company_id", companyIds)
    .eq("archived", false);

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  const assigneeCompanyIds = new Set(
    (existingAssigneeCards ?? []).map((c) => String(c.company_id))
  );

  const toTransfer: string[] = [];
  const toArchive: string[] = [];
  const alreadyHad: string[] = [];

  for (const card of owned) {
    const id = String(card.id);
    const companyId = String(card.company_id);
    if (assigneeCompanyIds.has(companyId)) {
      toArchive.push(id);
      alreadyHad.push(id);
    } else {
      toTransfer.push(id);
    }
  }

  const assignedAt = new Date().toISOString();
  const transferred: string[] = [];

  if (toTransfer.length > 0) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("crm_companies_pipeline")
      .update({
        created_by_user_id: assigneeUserId,
        pipeline_stage: "target",
        funnel_stage: "idea",
        assigned_by_user_id: profile.user_id,
        assigned_at: assignedAt,
        follow_up_step: 0,
        next_follow_up_at: null,
        last_touch_at: null,
        next_action: null,
      })
      .in("id", toTransfer)
      .eq("created_by_user_id", profile.user_id)
      .select("id");

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    transferred.push(...(updated ?? []).map((r) => String(r.id)));
  }

  if (toArchive.length > 0) {
    const { error: archiveErr } = await supabaseAdmin
      .from("crm_companies_pipeline")
      .update({ archived: true })
      .in("id", toArchive)
      .eq("created_by_user_id", profile.user_id);

    if (archiveErr) {
      return NextResponse.json({ error: archiveErr.message }, { status: 500 });
    }
  }

  const assigneeName =
    [assignee.first_name, assignee.last_name].filter(Boolean).join(" ").trim() ||
    assignee.email ||
    "teammate";

  return NextResponse.json({
    ok: true,
    transferred,
    already_had: alreadyHad,
    assignee: {
      user_id: assignee.user_id,
      name: assigneeName,
    },
  });
}
