/**
 * Metabase monthly import commit — roster + social + audience.
 * Creates athletes only when create_key is in approvedCreateKeys.
 * Never overwrites athlete_agents for existing athletes.
 */

import { AgentDirectoryCache } from "@/lib/import/agent-directory-cache";
import {
  AthleteRosterCache,
  formatAmbiguousNameReason,
} from "@/lib/import/athlete-roster-cache";
import {
  metabaseCreateKey,
  parseMetabaseUploads,
  splitDisplayName,
  type MetabaseUploadPart,
} from "@/lib/import/metabase-workbook";
import {
  processAudienceDataBulk,
  processSocialDataBulk,
} from "@/lib/import/process-social-audience-bulk";
import {
  normalizeAudienceRow,
  normalizeSocialRow,
  type ImportRowFailure,
  type SheetImportSummary,
} from "@/lib/import/social-audience";
import { parseAgentNames } from "@/lib/import/talent-info";
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { MetabaseUpdateColumn } from "@/lib/import/metabase-preview";

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

export type MetabaseDeniedUpdate = {
  athlete_id: string;
  deny: MetabaseUpdateColumn[];
};

export type MetabaseNameRemap = {
  create_key: string;
  athlete_id: string;
};

export type MetabaseMonthlyImportResult = {
  sheets: { roster: boolean; social: boolean; audience: boolean };
  roster: SheetImportSummary & { sheet: "Roster"; created: number; denied: number };
  social: SheetImportSummary;
  audience: SheetImportSummary;
  failures: ImportRowFailure[];
  approved_creates: number;
  denied_creates: number;
  remapped: number;
};

async function linkAgentsForNewAthlete(
  supabase: Supabase,
  athleteId: string,
  agentIds: string[]
): Promise<void> {
  if (agentIds.length === 0) return;
  for (let i = 0; i < agentIds.length; i++) {
    await supabase.from("athlete_agents").insert({
      athlete_id: athleteId,
      user_id: agentIds[i]!,
      is_primary: i === 0,
    });
  }
  if (agentIds[0]) {
    await supabase
      .from("athletes")
      .update({ current_agent_id: agentIds[0] })
      .eq("athlete_id", athleteId);
  }
}

async function appendAlias(
  supabase: Supabase,
  athleteId: string,
  alias: string
): Promise<void> {
  const trimmed = alias.trim();
  if (!trimmed) return;
  const { data } = await supabase
    .from("athletes")
    .select("name_aliases")
    .eq("athlete_id", athleteId)
    .maybeSingle();
  const existing = Array.isArray(data?.name_aliases)
    ? (data!.name_aliases as string[])
    : [];
  if (existing.some((a) => a.toLowerCase() === trimmed.toLowerCase())) return;
  await supabase
    .from("athletes")
    .update({
      name_aliases: [...existing, trimmed],
      updated_at: new Date().toISOString(),
    })
    .eq("athlete_id", athleteId);
}

export async function commitMetabaseMonthlyImport(
  supabase: Supabase,
  parts: MetabaseUploadPart[],
  approvedCreateKeys: string[],
  sourceFileName: string | null,
  options?: {
    deniedUpdates?: MetabaseDeniedUpdate[];
    nameRemaps?: MetabaseNameRemap[];
  }
): Promise<MetabaseMonthlyImportResult> {
  const approved = new Set(
    approvedCreateKeys.map((k) => metabaseCreateKey(k)).filter(Boolean)
  );

  const deniedSport = new Set<string>();
  const deniedSocial = new Set<string>();
  const deniedAudience = new Set<string>();
  for (const row of options?.deniedUpdates ?? []) {
    for (const col of row.deny ?? []) {
      if (col === "sport") deniedSport.add(row.athlete_id);
      if (col === "social") deniedSocial.add(row.athlete_id);
      if (col === "audience") deniedAudience.add(row.athlete_id);
    }
  }

  const remapByKey = new Map<string, string>();
  for (const r of options?.nameRemaps ?? []) {
    const key = metabaseCreateKey(r.create_key);
    if (key && r.athlete_id) remapByKey.set(key, r.athlete_id);
  }

  const workbook = await parseMetabaseUploads(parts);

  const rosterCache = await AthleteRosterCache.load(supabase);
  const agents = await AgentDirectoryCache.load(supabase);

  const failures: ImportRowFailure[] = [];
  const rosterSummary = {
    sheet: "Roster" as const,
    total: workbook.roster.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    created: 0,
    denied: 0,
  };

  /** Names allowed to receive social/audience (matched + approved creates + remaps). */
  const allowedNameKeys = new Set<string>();
  /** create_key → athlete_id for denial checks on social/audience */
  const athleteIdByNameKey = new Map<string, string>();

  const createCandidates = new Map<
    string,
    { display_name: string; sport: string | null; file_agent: string | null }
  >();

  for (const row of workbook.roster) {
    const key = metabaseCreateKey(row.display_name);
    const remappedId = remapByKey.get(key);
    const resolution = remappedId
      ? { athlete_id: remappedId, ambiguous: false as const }
      : rosterCache.resolveByName(row.display_name);

    if (!remappedId && resolution.ambiguous) {
      rosterSummary.skipped++;
      failures.push({
        sheet: "Roster",
        rowIndex: row.rowIndex,
        reason: formatAmbiguousNameReason(row.display_name, resolution.candidates),
      });
      continue;
    }

    if (resolution.athlete_id) {
      allowedNameKeys.add(key);
      athleteIdByNameKey.set(key, resolution.athlete_id);

      if (remappedId) {
        await appendAlias(supabase, resolution.athlete_id, row.display_name);
        rosterCache.register(
          resolution.athlete_id,
          // keep cache warm with alias path via re-load later
          row.display_name.split(/\s+/)[0] ?? row.display_name,
          row.display_name.split(/\s+/).slice(1).join(" "),
          [row.display_name]
        );
      }

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (row.sport && !deniedSport.has(resolution.athlete_id)) {
        updates.sport = row.sport;
      }
      const { error } = await supabase
        .from("athletes")
        .update(updates)
        .eq("athlete_id", resolution.athlete_id);
      if (error) {
        rosterSummary.failed++;
        failures.push({
          sheet: "Roster",
          rowIndex: row.rowIndex,
          reason: `Update failed: ${error.message}`,
        });
      } else {
        rosterSummary.updated++;
      }
      continue;
    }

    createCandidates.set(key, {
      display_name: row.display_name,
      sport: row.sport,
      file_agent: row.file_agent,
    });
  }

  for (const raw of workbook.socialRows) {
    const parsed = normalizeSocialRow(raw);
    if (!parsed.name_raw) continue;
    const key = metabaseCreateKey(parsed.name_raw);
    const remappedId = remapByKey.get(key);
    if (remappedId) {
      allowedNameKeys.add(key);
      athleteIdByNameKey.set(key, remappedId);
      continue;
    }
    const resolution = rosterCache.resolveByName(parsed.name_raw);
    if (resolution.athlete_id) {
      allowedNameKeys.add(key);
      athleteIdByNameKey.set(key, resolution.athlete_id);
      continue;
    }
    if (resolution.ambiguous) continue;
    if (!createCandidates.has(key)) {
      createCandidates.set(key, {
        display_name: parsed.name_raw,
        sport: null,
        file_agent: null,
      });
    }
  }

  for (const raw of workbook.audienceRows) {
    const parsed = normalizeAudienceRow(raw);
    if (!parsed.name_raw) continue;
    const key = metabaseCreateKey(parsed.name_raw);
    const remappedId = remapByKey.get(key);
    if (remappedId) {
      allowedNameKeys.add(key);
      athleteIdByNameKey.set(key, remappedId);
      continue;
    }
    const resolution = rosterCache.resolveByName(parsed.name_raw);
    if (resolution.athlete_id) {
      allowedNameKeys.add(key);
      athleteIdByNameKey.set(key, resolution.athlete_id);
      continue;
    }
    if (resolution.ambiguous) continue;
    if (!createCandidates.has(key)) {
      createCandidates.set(key, {
        display_name: parsed.name_raw,
        sport: null,
        file_agent: null,
      });
    }
  }

  // Apply remaps for names that only appear on social/audience (no roster row processed above)
  let remapped = 0;
  for (const [key, athleteId] of remapByKey) {
    const candidate = createCandidates.get(key);
    const displayName = candidate?.display_name ?? key;
    await appendAlias(supabase, athleteId, displayName);
    allowedNameKeys.add(key);
    athleteIdByNameKey.set(key, athleteId);
    createCandidates.delete(key);
    remapped++;

    if (candidate?.sport && !deniedSport.has(athleteId)) {
      await supabase
        .from("athletes")
        .update({ sport: candidate.sport, updated_at: new Date().toISOString() })
        .eq("athlete_id", athleteId);
    }
  }

  let approvedCreates = 0;
  let deniedCreates = 0;

  for (const [key, candidate] of createCandidates) {
    if (!approved.has(key)) {
      deniedCreates++;
      rosterSummary.denied++;
      rosterSummary.skipped++;
      continue;
    }

    const { first_name, last_name } = splitDisplayName(candidate.display_name);
    const agentStrings = parseAgentNames(candidate.file_agent);
    const agentIds: string[] = [];
    for (const s of agentStrings) {
      const id = agents.resolve(s);
      if (id && !agentIds.includes(id)) agentIds.push(id);
    }

    const athleteId = await rosterCache.insertAthletePublic(supabase, {
      first_name,
      last_name,
      sport: candidate.sport,
      country: null,
      current_agent_id: agentIds[0] ?? null,
    });

    if (!athleteId) {
      rosterSummary.failed++;
      failures.push({
        sheet: "Roster",
        rowIndex: 0,
        reason: `Failed to create athlete "${candidate.display_name}"`,
      });
      continue;
    }

    await linkAgentsForNewAthlete(supabase, athleteId, agentIds);
    allowedNameKeys.add(key);
    athleteIdByNameKey.set(key, athleteId);
    approvedCreates++;
    rosterSummary.created++;
    rosterSummary.inserted++;
  }

  const socialSummary: SheetImportSummary = {
    sheet: "Social Data",
    total: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const audienceSummary: SheetImportSummary = {
    sheet: "Audience Data",
    total: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };

  const rosterAfter = await AthleteRosterCache.load(supabase);

  const socialContexts: Array<{
    rowIndex: number;
    parsed: ReturnType<typeof normalizeSocialRow>;
  }> = [];

  for (let idx = 0; idx < workbook.socialRows.length; idx++) {
    const rowIndex = workbook.socialHeaderRowIndex + idx + 2;
    const parsed = normalizeSocialRow(workbook.socialRows[idx]!);
    if (!parsed.name_raw) {
      socialSummary.skipped++;
      failures.push({ sheet: "Social Data", rowIndex, reason: "Missing Name" });
      continue;
    }
    const key = metabaseCreateKey(parsed.name_raw);
    if (!allowedNameKeys.has(key)) {
      socialSummary.skipped++;
      failures.push({
        sheet: "Social Data",
        rowIndex,
        reason: `Skipped: athlete "${parsed.name_raw}" was not matched and not approved for create`,
      });
      continue;
    }
    const athleteId =
      athleteIdByNameKey.get(key) ??
      rosterAfter.resolveByName(parsed.name_raw).athlete_id;
    if (athleteId && deniedSocial.has(athleteId)) {
      socialSummary.skipped++;
      failures.push({
        sheet: "Social Data",
        rowIndex,
        reason: `Skipped: social update denied for "${parsed.name_raw}"`,
      });
      continue;
    }
    const resolution = rosterAfter.resolveByName(parsed.name_raw);
    // Remapped names may only resolve after alias reload
    if (!resolution.athlete_id && !athleteId) {
      socialSummary.skipped++;
      failures.push({
        sheet: "Social Data",
        rowIndex,
        reason: `Could not resolve athlete "${parsed.name_raw}"`,
      });
      continue;
    }
    if (resolution.ambiguous && !athleteId) {
      socialSummary.skipped++;
      failures.push({
        sheet: "Social Data",
        rowIndex,
        reason: formatAmbiguousNameReason(parsed.name_raw, resolution.candidates),
      });
      continue;
    }
    socialContexts.push({ rowIndex, parsed });
  }

  await processSocialDataBulk(
    supabase,
    rosterAfter,
    socialContexts,
    sourceFileName,
    socialSummary,
    failures,
    undefined,
    { createMissingAthletes: false }
  );

  const audienceContexts: Array<{
    rowIndex: number;
    parsed: ReturnType<typeof normalizeAudienceRow>;
  }> = [];

  for (let idx = 0; idx < workbook.audienceRows.length; idx++) {
    const rowIndex = workbook.audienceHeaderRowIndex + idx + 2;
    const parsed = normalizeAudienceRow(workbook.audienceRows[idx]!);
    if (!parsed.name_raw) {
      audienceSummary.skipped++;
      failures.push({ sheet: "Audience Data", rowIndex, reason: "Missing Name" });
      continue;
    }
    const key = metabaseCreateKey(parsed.name_raw);
    if (!allowedNameKeys.has(key)) {
      audienceSummary.skipped++;
      failures.push({
        sheet: "Audience Data",
        rowIndex,
        reason: `Skipped: athlete "${parsed.name_raw}" was not matched and not approved for create`,
      });
      continue;
    }
    const athleteId =
      athleteIdByNameKey.get(key) ??
      rosterAfter.resolveByName(parsed.name_raw).athlete_id;
    if (athleteId && deniedAudience.has(athleteId)) {
      audienceSummary.skipped++;
      failures.push({
        sheet: "Audience Data",
        rowIndex,
        reason: `Skipped: audience update denied for "${parsed.name_raw}"`,
      });
      continue;
    }
    audienceContexts.push({ rowIndex, parsed });
  }

  await processAudienceDataBulk(
    supabase,
    rosterAfter,
    audienceContexts,
    sourceFileName,
    audienceSummary,
    failures,
    undefined,
    { createMissingAthletes: false }
  );

  return {
    sheets: workbook.sheets,
    roster: rosterSummary,
    social: socialSummary,
    audience: audienceSummary,
    failures,
    approved_creates: approvedCreates,
    denied_creates: deniedCreates,
    remapped,
  };
}
