/**
 * Dry-run Metabase monthly import preview — zero DB writes.
 */

import { AgentDirectoryCache } from "@/lib/import/agent-directory-cache";
import {
  AthleteRosterCache,
  formatAmbiguousNameReason,
} from "@/lib/import/athlete-roster-cache";
import {
  buildHeaderMapping,
  metabaseCreateKey,
  parseMetabaseUploads,
  socialNameFromRow,
  type MetabaseSheetKind,
  type MetabaseUploadPart,
} from "@/lib/import/metabase-workbook";
import { parseAgentNames } from "@/lib/import/talent-info";
import {
  normalizeAudienceRow,
  normalizeSocialRow,
} from "@/lib/import/social-audience";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

export type MetabasePreviewAgent = {
  email: string;
  is_primary: boolean;
};

export type MetricDiff = {
  current: number | null;
  incoming: number | null;
};

export type MetabaseUpdateColumn = "sport" | "social" | "audience";

export type MetabaseWillUpdate = {
  athlete_id: string;
  display_name: string;
  sport_current: string | null;
  sport_incoming: string | null;
  sport_will_change: boolean;
  has_social: boolean;
  has_audience: boolean;
  audience_row_count: number;
  social_diff: {
    total_followers: MetricDiff;
    ig_followers: MetricDiff;
    avg_er_20p: MetricDiff;
  } | null;
  audience_diff: {
    current_row_count: number;
    incoming_row_count: number;
  } | null;
  columns_updating: MetabaseUpdateColumn[];
  current_agents: MetabasePreviewAgent[];
  file_agent: string | null;
  agent_action: "preserve_existing";
};

export type MetabaseWillCreate = {
  create_key: string;
  display_name: string;
  sport: string | null;
  file_agent: string | null;
  agent_resolved: boolean;
  agent_email_or_name: string | null;
  has_social: boolean;
  has_audience: boolean;
  audience_row_count: number;
  appears_on_sheets: MetabaseSheetKind[];
};

export type MetabaseDuplicateDetail = {
  sheet: string;
  display_name: string;
  row_count: number;
  reason: string;
  occurrences: Array<{ rowIndex: number; summary: string }>;
};

export type MetabaseImportPreview = {
  sheets: { roster: boolean; social: boolean; audience: boolean };
  headerMapping: Array<{ sheet: string; source: string; target: string | "ignored" }>;
  willUpdate: MetabaseWillUpdate[];
  willCreate: MetabaseWillCreate[];
  notUpdated: Array<{
    athlete_id: string;
    display_name: string;
    reason: "not_in_file";
  }>;
  ambiguous: Array<{
    sheet: string;
    display_name: string;
    candidate_ids: string[];
    candidate_names: string[];
  }>;
  duplicatesInFile: MetabaseDuplicateDetail[];
  /** Lightweight list for remapping unmatched file names to existing athletes. */
  rosterOptions: Array<{ athlete_id: string; display_name: string }>;
  counts: {
    will_update: number;
    will_create: number;
    not_updated: number;
    ambiguous: number;
    duplicates: number;
  };
};

type Occ = { rowIndex: number; summary: string; display: string };

function groupNameDuplicates(
  items: Occ[],
  sheet: string,
  reason: string
): MetabaseDuplicateDetail[] {
  const byKey = new Map<string, Occ[]>();
  for (const item of items) {
    const key = metabaseCreateKey(item.display);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(item);
    byKey.set(key, list);
  }
  return [...byKey.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({
      sheet,
      display_name: list[0]!.display,
      row_count: list.length,
      reason,
      occurrences: list.map((o) => ({ rowIndex: o.rowIndex, summary: o.summary })),
    }));
}

export async function buildMetabaseImportPreview(
  supabase: Supabase,
  parts: MetabaseUploadPart[]
): Promise<MetabaseImportPreview> {
  const workbook = await parseMetabaseUploads(parts);

  const roster = await AthleteRosterCache.load(supabase);
  const agents = await AgentDirectoryCache.load(supabase);

  const { data: athleteRows, error: athletesErr } = await supabase
    .from("athletes")
    .select("athlete_id, first_name, last_name, sport")
    .order("last_name")
    .order("first_name");
  if (athletesErr) throw new Error(athletesErr.message);

  const athletes = athleteRows ?? [];
  const athleteById = new Map(
    athletes.map((a) => [
      a.athlete_id,
      {
        display_name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
        sport: a.sport as string | null,
      },
    ])
  );

  const { data: agentLinks } = await supabase
    .from("athlete_agents")
    .select("athlete_id, is_primary, profiles:user_id (email)");

  const agentsByAthlete = new Map<string, MetabasePreviewAgent[]>();
  for (const link of agentLinks ?? []) {
    const profile = link.profiles as
      | { email?: string | null }
      | { email?: string | null }[]
      | null;
    const emailRaw = Array.isArray(profile) ? profile[0]?.email : profile?.email;
    const email = emailRaw?.trim() || "(no email)";
    const list = agentsByAthlete.get(link.athlete_id) ?? [];
    list.push({ email, is_primary: Boolean(link.is_primary) });
    agentsByAthlete.set(link.athlete_id, list);
  }

  const { data: existingSocial } = await supabase
    .from("athlete_social_data")
    .select("athlete_id, total_followers, ig_followers, avg_er_20p");
  const socialByAthlete = new Map(
    (existingSocial ?? []).map((s) => [
      s.athlete_id as string,
      {
        total_followers: (s.total_followers as number | null) ?? null,
        ig_followers: (s.ig_followers as number | null) ?? null,
        avg_er_20p: (s.avg_er_20p as number | null) ?? null,
      },
    ])
  );

  const { data: audienceCountsRaw } = await supabase
    .from("athlete_audience_data")
    .select("athlete_id");
  const audienceCountByAthlete = new Map<string, number>();
  for (const row of audienceCountsRaw ?? []) {
    const id = row.athlete_id as string;
    audienceCountByAthlete.set(id, (audienceCountByAthlete.get(id) ?? 0) + 1);
  }

  type FileNameMeta = {
    display_name: string;
    sport: string | null;
    file_agent: string | null;
    sheets: Set<MetabaseSheetKind>;
    social: boolean;
    audience_count: number;
    socialParsed: ReturnType<typeof normalizeSocialRow> | null;
  };

  const byCreateKey = new Map<string, FileNameMeta>();

  function ensureMeta(display_name: string): FileNameMeta {
    const key = metabaseCreateKey(display_name);
    let meta = byCreateKey.get(key);
    if (!meta) {
      meta = {
        display_name,
        sport: null,
        file_agent: null,
        sheets: new Set(),
        social: false,
        audience_count: 0,
        socialParsed: null,
      };
      byCreateKey.set(key, meta);
    }
    return meta;
  }

  const rosterDupItems: Occ[] = [];
  for (const row of workbook.roster) {
    const meta = ensureMeta(row.display_name);
    meta.sheets.add("Roster");
    if (row.sport) meta.sport = row.sport;
    if (row.file_agent) meta.file_agent = row.file_agent;
    rosterDupItems.push({
      display: row.display_name,
      rowIndex: row.rowIndex,
      summary: `Agent=${row.file_agent ?? "—"} · Sport=${row.sport ?? "—"}`,
    });
  }

  const socialDupItems: Occ[] = [];
  for (let idx = 0; idx < workbook.socialRows.length; idx++) {
    const raw = workbook.socialRows[idx]!;
    const parsed = normalizeSocialRow(raw);
    const name = parsed.name_raw ?? socialNameFromRow(raw);
    if (!name) continue;
    const rowIndex = workbook.socialHeaderRowIndex + idx + 2;
    const meta = ensureMeta(name);
    meta.sheets.add("Social");
    meta.social = true;
    meta.socialParsed = parsed;
    socialDupItems.push({
      display: name,
      rowIndex,
      summary: `Total Followers=${parsed.total_followers ?? "—"} · IG=${parsed.ig_followers ?? "—"} · ER=${parsed.avg_er_20p ?? "—"}`,
    });
  }

  const audiencePairMap = new Map<string, Occ[]>();
  for (let idx = 0; idx < workbook.audienceRows.length; idx++) {
    const raw = workbook.audienceRows[idx]!;
    const parsed = normalizeAudienceRow(raw);
    const name = parsed.name_raw;
    if (!name) continue;
    const rowIndex = workbook.audienceHeaderRowIndex + idx + 2;
    const meta = ensureMeta(name);
    meta.sheets.add("Audience");
    meta.audience_count++;

    if (!parsed.audience_name || !parsed.audience_category) continue;
    const pairKey = `${metabaseCreateKey(name)}|${parsed.audience_category}|${parsed.audience_name.toLowerCase()}`;
    const list = audiencePairMap.get(pairKey) ?? [];
    list.push({
      display: name,
      rowIndex,
      summary: `${parsed.audience_category} / ${parsed.audience_name} · ${parsed.ig_audience_percent ?? "—"}% · #${parsed.ig_audience_count ?? "—"}`,
    });
    audiencePairMap.set(pairKey, list);
  }

  const duplicatesInFile: MetabaseDuplicateDetail[] = [
    ...groupNameDuplicates(rosterDupItems, "Roster", "Same Name appears more than once on Roster"),
    ...groupNameDuplicates(socialDupItems, "Social", "Same Name appears more than once on Social"),
  ];
  for (const [, list] of audiencePairMap) {
    if (list.length <= 1) continue;
    const firstSummary = list[0]!.summary;
    const categoryName = firstSummary.split(" · ")[0] ?? "Audience row";
    duplicatesInFile.push({
      sheet: "Audience",
      display_name: list[0]!.display,
      row_count: list.length,
      reason: `Same athlete + ${categoryName} appears more than once`,
      occurrences: list.map((o) => ({ rowIndex: o.rowIndex, summary: o.summary })),
    });
  }

  const ambiguous: MetabaseImportPreview["ambiguous"] = [];
  const willUpdate: MetabaseWillUpdate[] = [];
  const willCreate: MetabaseWillCreate[] = [];
  const matchedAthleteIds = new Set<string>();

  for (const [, meta] of byCreateKey) {
    const resolution = roster.resolveByName(meta.display_name);

    if (resolution.ambiguous) {
      const sheet = meta.sheets.has("Roster")
        ? "Roster"
        : meta.sheets.has("Social")
          ? "Social"
          : "Audience";
      ambiguous.push({
        sheet,
        display_name: meta.display_name,
        candidate_ids: (resolution.candidates ?? []).map((c) => c.athlete_id),
        candidate_names: (resolution.candidates ?? []).map((c) =>
          [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
        ),
      });
      void formatAmbiguousNameReason(meta.display_name, resolution.candidates);
      continue;
    }

    if (resolution.athlete_id) {
      matchedAthleteIds.add(resolution.athlete_id);
      const current = athleteById.get(resolution.athlete_id);
      const currentAgents = agentsByAthlete.get(resolution.athlete_id) ?? [];
      currentAgents.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

      const sportCurrent = current?.sport ?? null;
      const sportIncoming = meta.sport;
      const sport_will_change = Boolean(
        sportIncoming &&
          sportIncoming.trim() &&
          sportIncoming.trim() !== (sportCurrent ?? "").trim()
      );

      let social_diff: MetabaseWillUpdate["social_diff"] = null;
      if (meta.social && meta.socialParsed) {
        const existing = socialByAthlete.get(resolution.athlete_id);
        social_diff = {
          total_followers: {
            current: existing?.total_followers ?? null,
            incoming: meta.socialParsed.total_followers,
          },
          ig_followers: {
            current: existing?.ig_followers ?? null,
            incoming: meta.socialParsed.ig_followers,
          },
          avg_er_20p: {
            current: existing?.avg_er_20p ?? null,
            incoming: meta.socialParsed.avg_er_20p,
          },
        };
      }

      const audience_diff =
        meta.audience_count > 0
          ? {
              current_row_count: audienceCountByAthlete.get(resolution.athlete_id) ?? 0,
              incoming_row_count: meta.audience_count,
            }
          : null;

      const columns_updating: MetabaseUpdateColumn[] = [];
      if (sport_will_change) columns_updating.push("sport");
      if (meta.social) columns_updating.push("social");
      if (meta.audience_count > 0) columns_updating.push("audience");

      willUpdate.push({
        athlete_id: resolution.athlete_id,
        display_name: current?.display_name || meta.display_name,
        sport_current: sportCurrent,
        sport_incoming: sportIncoming,
        sport_will_change,
        has_social: meta.social,
        has_audience: meta.audience_count > 0,
        audience_row_count: meta.audience_count,
        social_diff,
        audience_diff,
        columns_updating,
        current_agents: currentAgents,
        file_agent: meta.file_agent,
        agent_action: "preserve_existing",
      });
      continue;
    }

    const agentStrings = parseAgentNames(meta.file_agent);
    const firstAgent = agentStrings[0] ?? null;
    const agentResolved = firstAgent ? Boolean(agents.resolve(firstAgent)) : false;

    willCreate.push({
      create_key: metabaseCreateKey(meta.display_name),
      display_name: meta.display_name,
      sport: meta.sport,
      file_agent: meta.file_agent,
      agent_resolved: agentResolved,
      agent_email_or_name: firstAgent,
      has_social: meta.social,
      has_audience: meta.audience_count > 0,
      audience_row_count: meta.audience_count,
      appears_on_sheets: [...meta.sheets],
    });
  }

  willUpdate.sort((a, b) => a.display_name.localeCompare(b.display_name));
  willCreate.sort((a, b) => a.display_name.localeCompare(b.display_name));
  ambiguous.sort((a, b) => a.display_name.localeCompare(b.display_name));

  const notUpdated = athletes
    .filter((a) => !matchedAthleteIds.has(a.athlete_id))
    .map((a) => ({
      athlete_id: a.athlete_id,
      display_name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
      reason: "not_in_file" as const,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const rosterOptions = athletes.map((a) => ({
    athlete_id: a.athlete_id,
    display_name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
  }));

  return {
    sheets: workbook.sheets,
    headerMapping: buildHeaderMapping({
      rosterHeaders: workbook.rosterHeaders,
      socialHeaders: workbook.socialHeaders,
      audienceHeaders: workbook.audienceHeaders,
    }),
    willUpdate,
    willCreate,
    notUpdated,
    ambiguous,
    duplicatesInFile,
    rosterOptions,
    counts: {
      will_update: willUpdate.length,
      will_create: willCreate.length,
      not_updated: notUpdated.length,
      ambiguous: ambiguous.length,
      duplicates: duplicatesInFile.length,
    },
  };
}
