import { AgentDirectoryCache } from "@/lib/import/agent-directory-cache";
import { AthleteRosterCache, formatAmbiguousNameReason } from "@/lib/import/athlete-roster-cache";
import type { ImportRowFailure, SheetImportSummary } from "@/lib/import/social-audience";
import type { createServiceRoleClient } from "@/lib/supabase/server";

export type ParsedTalentInfoRow = {
  first_name: string;
  last_name: string;
  sport: string | null;
  agent_raw: string | null;
  country: string | null;
};

const TALENT_INFO_HEADER_MAP: Record<string, string> = {
  "#": "_index",
  "first name": "first_name",
  firstname: "first_name",
  "last name": "last_name",
  lastname: "last_name",
  sport: "sport",
  agent: "agent_raw",
  agents: "agent_raw",
  country: "country",
  "country of origin": "country",
};

function normalizeHeaders(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(row)) {
    const key = String(rawKey).toLowerCase().trim();
    const normalizedKey = TALENT_INFO_HEADER_MAP[key] ?? rawKey;
    out[normalizedKey] = value;
  }
  return out;
}

function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function normalizeTalentInfoRow(row: Record<string, unknown>): ParsedTalentInfoRow | null {
  const r = normalizeHeaders(row);
  const first_name = toStringOrNull(r.first_name);
  const last_name = toStringOrNull(r.last_name) ?? "";
  if (!first_name) return null;

  return {
    first_name,
    last_name,
    sport: toStringOrNull(r.sport),
    agent_raw: toStringOrNull(r.agent_raw),
    country: toStringOrNull(r.country),
  };
}

export function displayTalentName(row: ParsedTalentInfoRow): string {
  return row.last_name.trim() ? `${row.first_name} ${row.last_name}` : row.first_name;
}

export function parseAgentNames(agentRaw: string | null): string[] {
  if (!agentRaw) return [];
  return agentRaw
    .split(/[/,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

async function linkAgents(
  supabase: Supabase,
  athleteId: string,
  agentIds: string[],
  setPrimaryIfNone: boolean
): Promise<void> {
  if (agentIds.length === 0) return;

  const { data: existingLinks } = await supabase
    .from("athlete_agents")
    .select("user_id, is_primary")
    .eq("athlete_id", athleteId);

  const linked = new Set((existingLinks ?? []).map((l) => l.user_id));
  const hasPrimary = (existingLinks ?? []).some((l) => l.is_primary);

  for (let i = 0; i < agentIds.length; i++) {
    const userId = agentIds[i]!;
    if (linked.has(userId)) continue;
    const isPrimary = setPrimaryIfNone && !hasPrimary && i === 0;
    const { error } = await supabase.from("athlete_agents").insert({
      athlete_id: athleteId,
      user_id: userId,
      is_primary: isPrimary,
    });
    if (!error) linked.add(userId);
  }

  if (setPrimaryIfNone && !hasPrimary && agentIds[0]) {
    await supabase
      .from("athletes")
      .update({ current_agent_id: agentIds[0] })
      .eq("athlete_id", athleteId);
  }
}

export async function processTalentInfoRows(
  supabase: Supabase,
  roster: AthleteRosterCache,
  agents: AgentDirectoryCache,
  rows: Record<string, unknown>[],
  rowIndexForObject: (objectIndex: number) => number,
  summary: SheetImportSummary,
  failures: ImportRowFailure[],
  onRowProcessed?: (index: number, total: number) => void
): Promise<void> {
  summary.total = rows.length;

  for (let idx = 0; idx < rows.length; idx++) {
    const rowIndex = rowIndexForObject(idx);
    const rawRow = rows[idx] as Record<string, unknown>;

    try {
      const parsed = normalizeTalentInfoRow(rawRow);
      if (!parsed) {
        summary.skipped++;
        continue;
      }

      const agentStrings = parseAgentNames(parsed.agent_raw);
      const agentIds: string[] = [];
      for (const name of agentStrings) {
        const id = agents.resolve(name);
        if (id && !agentIds.includes(id)) agentIds.push(id);
      }
      const primaryAgentId = agentIds[0] ?? null;

      const match = roster.resolveByFirstLast(parsed.first_name, parsed.last_name);

      if (match.ambiguous) {
        summary.skipped++;
        failures.push({
          sheet: "Talent Info",
          rowIndex,
          reason: formatAmbiguousNameReason(displayTalentName(parsed), match.candidates),
        });
        continue;
      }

      if (match.athlete_id) {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (parsed.sport) updates.sport = parsed.sport;
        if (parsed.country) updates.country = parsed.country;

        const { error: updateErr } = await supabase
          .from("athletes")
          .update(updates)
          .eq("athlete_id", match.athlete_id);

        if (updateErr) {
          summary.failed++;
          failures.push({
            sheet: "Talent Info",
            rowIndex,
            reason: `Update failed: ${updateErr.message}`,
          });
          continue;
        }

        await linkAgents(supabase, match.athlete_id, agentIds, false);
        summary.updated++;
        continue;
      }

      const athleteId = await roster.insertAthletePublic(supabase, {
        first_name: parsed.first_name,
        last_name: parsed.last_name,
        sport: parsed.sport,
        country: parsed.country,
        current_agent_id: primaryAgentId,
      });

      if (!athleteId) {
        summary.failed++;
        failures.push({
          sheet: "Talent Info",
          rowIndex,
          reason: "Insert failed.",
        });
        continue;
      }

      await linkAgents(supabase, athleteId, agentIds, true);
      summary.inserted++;
    } catch (e: unknown) {
      summary.failed++;
      failures.push({
        sheet: "Talent Info",
        rowIndex,
        reason: e instanceof Error ? e.message : "Unexpected error while processing row",
      });
    } finally {
      onRowProcessed?.(idx + 1, rows.length);
    }
  }
}
