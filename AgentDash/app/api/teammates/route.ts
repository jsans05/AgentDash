import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireNonAccounting } from "@/lib/auth";
import { NextResponse } from "next/server";

export type Teammate = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string;
};

function parseAthleteIds(searchParams: URLSearchParams): string[] {
  const multi = searchParams.getAll("athlete_id").map((s) => s.trim()).filter(Boolean);
  const csv = String(searchParams.get("athlete_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...multi, ...csv])];
}

/**
 * GET /api/teammates
 *
 * Returns assignable teammates excluding the current user.
 *
 * Without athlete scope: sales + agents + admins (legacy / pipeline board).
 * With ?athlete_id= / ?athlete_ids=: sales users, plus agents who are
 * primary or secondary on every scoped athlete (intersection).
 */
export async function GET(req: Request) {
  const profile = await requireNonAccounting();
  const supabaseAdmin = await createServiceRoleClient();
  const athleteIds = parseAthleteIds(new URL(req.url).searchParams);

  const { data: salesRows, error: salesErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, first_name, last_name, email, role")
    .eq("role", "sales")
    .neq("user_id", profile.user_id)
    .order("first_name", { ascending: true });

  if (salesErr) {
    return NextResponse.json({ error: salesErr.message }, { status: 500 });
  }

  const byId = new Map<string, Teammate>();
  for (const row of salesRows ?? []) {
    byId.set(String(row.user_id), {
      user_id: String(row.user_id),
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      email: row.email ?? null,
      role: String(row.role),
    });
  }

  if (athleteIds.length === 0) {
    // Unscoped (e.g. pipeline board): keep prior broad list.
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name, email, role")
      .in("role", ["admin", "sales", "agent"])
      .neq("user_id", profile.user_id)
      .order("first_name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      teammates: (data ?? []).map((row) => ({
        user_id: String(row.user_id),
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        email: row.email ?? null,
        role: String(row.role),
      })),
    });
  }

  // Agents linked to each athlete (athlete_agents ∪ current_agent_id); keep intersection.
  const agentIdSets: Set<string>[] = [];
  for (const athleteId of athleteIds) {
    const [{ data: links, error: linkErr }, { data: athlete, error: athleteErr }] =
      await Promise.all([
        supabaseAdmin.from("athlete_agents").select("user_id").eq("athlete_id", athleteId),
        supabaseAdmin
          .from("athletes")
          .select("current_agent_id")
          .eq("athlete_id", athleteId)
          .maybeSingle(),
      ]);
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 500 });
    }
    if (athleteErr) {
      return NextResponse.json({ error: athleteErr.message }, { status: 500 });
    }
    const set = new Set((links ?? []).map((l) => String(l.user_id)));
    if (athlete?.current_agent_id) set.add(String(athlete.current_agent_id));
    agentIdSets.push(set);
  }

  let eligibleAgentIds = agentIdSets[0] ?? new Set<string>();
  for (let i = 1; i < agentIdSets.length; i++) {
    const next = agentIdSets[i]!;
    eligibleAgentIds = new Set([...eligibleAgentIds].filter((id) => next.has(id)));
  }
  eligibleAgentIds.delete(profile.user_id);

  if (eligibleAgentIds.size > 0) {
    const { data: agentRows, error: agentErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name, last_name, email, role")
      .in("user_id", [...eligibleAgentIds])
      .eq("role", "agent");

    if (agentErr) {
      return NextResponse.json({ error: agentErr.message }, { status: 500 });
    }

    for (const row of agentRows ?? []) {
      byId.set(String(row.user_id), {
        user_id: String(row.user_id),
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        email: row.email ?? null,
        role: String(row.role),
      });
    }
  }

  const teammates = [...byId.values()].sort((a, b) => {
    const an = [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.email || "";
    const bn = [b.first_name, b.last_name].filter(Boolean).join(" ").trim() || b.email || "";
    return an.localeCompare(bn, undefined, { sensitivity: "base" });
  });

  return NextResponse.json({ teammates, athlete_ids: athleteIds });
}
