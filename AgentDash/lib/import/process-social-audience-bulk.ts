import { AthleteRosterCache, formatAmbiguousNameReason } from "@/lib/import/athlete-roster-cache";
import { BULK_UPSERT_CHUNK, chunkArray, dedupeByKey } from "@/lib/import/chunk";
import type { ParsedAudienceRow, ParsedSocialRow } from "@/lib/import/social-audience";
import { resolveAudiencePercentFraction } from "@/lib/athlete-data";
import type { ImportRowFailure, SheetImportSummary } from "@/lib/import/social-audience";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

type SocialRowContext = {
  rowIndex: number;
  parsed: ParsedSocialRow;
};

type AudienceRowContext = {
  rowIndex: number;
  parsed: ParsedAudienceRow;
};

type PayloadWithRow<T> = {
  payload: Record<string, unknown>;
  rowIndex: number;
  parsed: T;
};

function athleteIdFromName(
  roster: AthleteRosterCache,
  nameToAthleteId: Map<string, string | null>,
  nameRaw: string
): { athleteId: string | null; reason: string | null } {
  const trimmed = nameRaw.trim();
  const athleteId = nameToAthleteId.get(trimmed) ?? null;
  if (athleteId) return { athleteId, reason: null };

  const resolution = roster.resolveByName(trimmed);
  if (resolution.ambiguous) {
    return {
      athleteId: null,
      reason: formatAmbiguousNameReason(trimmed, resolution.candidates),
    };
  }
  return {
    athleteId: null,
    reason: "Could not find or create athlete from Name. Check spelling or add them on Talent Info.",
  };
}

function socialConflictKey(row: Record<string, unknown>): string {
  return String(row.athlete_id);
}

function audienceConflictKey(row: Record<string, unknown>): string {
  return `${row.athlete_id}|${row.audience_category}|${row.audience_name}`;
}

async function upsertChunks(
  supabase: Supabase,
  table: "athlete_social_data" | "athlete_audience_data",
  payloads: Record<string, unknown>[],
  onConflict: string,
  conflictKey: (row: Record<string, unknown>) => string,
  existingKeys: Set<string>,
  summary: SheetImportSummary,
  failures: ImportRowFailure[],
  sheet: "Social Data" | "Audience Data"
): Promise<void> {
  const { items: dedupedPayloads } = dedupeByKey(payloads, conflictKey);

  for (const chunk of chunkArray(dedupedPayloads, BULK_UPSERT_CHUNK)) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) {
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from(table).upsert(row, { onConflict });
        if (rowErr) {
          summary.failed++;
          failures.push({
            sheet,
            rowIndex: 0,
            reason: `Upsert failed: ${rowErr.message}`,
          });
        } else {
          const key = conflictKey(row);
          if (existingKeys.has(key)) summary.updated++;
          else {
            summary.inserted++;
            existingKeys.add(key);
          }
        }
      }
      continue;
    }

    for (const row of chunk) {
      const key = conflictKey(row);
      if (existingKeys.has(key)) summary.updated++;
      else {
        summary.inserted++;
        existingKeys.add(key);
      }
    }
  }
}

export async function processSocialDataBulk(
  supabase: Supabase,
  roster: AthleteRosterCache,
  rows: SocialRowContext[],
  sourceFileName: string | null,
  summary: SheetImportSummary,
  failures: ImportRowFailure[],
  onRowDone?: () => void,
  options?: { createMissingAthletes?: boolean }
): Promise<void> {
  summary.total = rows.length;
  const createMissing = options?.createMissingAthletes !== false;

  const namesNeeded: string[] = [];
  for (const { parsed } of rows) {
    if (parsed.name_raw) namesNeeded.push(parsed.name_raw);
  }

  const nameToAthleteId = createMissing
    ? await roster.ensureManyByName(supabase, namesNeeded)
    : roster.resolveManyByName(namesNeeded);
  const existingSocialIds = new Set<string>();

  let from = 0;
  while (true) {
    const { data, error } = await supabase.from("athlete_social_data").select("athlete_id").range(from, from + 999);
    if (error) break;
    for (const row of data ?? []) existingSocialIds.add(row.athlete_id);
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const staged: PayloadWithRow<ParsedSocialRow>[] = [];

  for (const { rowIndex, parsed } of rows) {
    try {
      if (!parsed.name_raw) {
        summary.skipped++;
        failures.push({ sheet: "Social Data", rowIndex, reason: "Missing Name" });
        continue;
      }

      const { athleteId, reason } = athleteIdFromName(roster, nameToAthleteId, parsed.name_raw);
      if (!athleteId) {
        summary.skipped++;
        failures.push({
          sheet: "Social Data",
          rowIndex,
          reason: reason ?? "Could not resolve athlete.",
        });
        continue;
      }

      staged.push({
        rowIndex,
        parsed,
        payload: {
          athlete_id: athleteId,
          talent_id: parsed.talent_id,
          name_raw: parsed.name_raw,
          total_followers: parsed.total_followers,
          avg_er_20p: parsed.avg_er_20p,
          total_lifetime_posts: parsed.total_lifetime_posts,
          ig_followers: parsed.ig_followers,
          avg_er_ig_20p: parsed.avg_er_ig_20p,
          ig_lifetime_posts: parsed.ig_lifetime_posts,
          tt_followers: parsed.tt_followers,
          avg_er_tt_20p: parsed.avg_er_tt_20p,
          tt_lifetime_posts: parsed.tt_lifetime_posts,
          fb_followers: parsed.fb_followers,
          avg_er_fb_20p: parsed.avg_er_fb_20p,
          fb_lifetime_posts: parsed.fb_lifetime_posts,
          x_followers: parsed.x_followers,
          avg_er_x_20p: parsed.avg_er_x_20p,
          x_lifetime_posts: parsed.x_lifetime_posts,
          source_file_name: sourceFileName,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (e: unknown) {
      summary.failed++;
      failures.push({
        sheet: "Social Data",
        rowIndex,
        reason: e instanceof Error ? e.message : "Unexpected error while processing row",
      });
    } finally {
      onRowDone?.();
    }
  }

  await upsertChunks(
    supabase,
    "athlete_social_data",
    staged.map((s) => s.payload),
    "athlete_id",
    socialConflictKey,
    existingSocialIds,
    summary,
    failures,
    "Social Data"
  );
}

export async function processAudienceDataBulk(
  supabase: Supabase,
  roster: AthleteRosterCache,
  rows: AudienceRowContext[],
  sourceFileName: string | null,
  summary: SheetImportSummary,
  failures: ImportRowFailure[],
  onRowDone?: () => void,
  options?: { createMissingAthletes?: boolean }
): Promise<void> {
  summary.total = rows.length;
  const createMissing = options?.createMissingAthletes !== false;

  const namesNeeded: string[] = [];
  for (const { parsed } of rows) {
    if (parsed.name_raw) namesNeeded.push(parsed.name_raw);
  }

  const nameToAthleteId = createMissing
    ? await roster.ensureManyByName(supabase, namesNeeded)
    : roster.resolveManyByName(namesNeeded);

  const existingKeys = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("athlete_audience_data")
      .select("athlete_id, audience_category, audience_name")
      .range(from, from + 999);
    if (error) break;
    for (const row of data ?? []) {
      existingKeys.add(
        `${row.athlete_id}|${row.audience_category}|${row.audience_name}`
      );
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }

  const staged: PayloadWithRow<ParsedAudienceRow>[] = [];

  for (const { rowIndex, parsed } of rows) {
    try {
      if (!parsed.name_raw) {
        audienceSkipped(summary, failures, rowIndex, "Missing Name");
        continue;
      }
      if (!parsed.audience_name) {
        audienceSkipped(summary, failures, rowIndex, "Missing Audience Name");
        continue;
      }
      if (!parsed.audience_category) {
        audienceSkipped(summary, failures, rowIndex, "Audience Category is missing or invalid");
        continue;
      }

      const { athleteId, reason } = athleteIdFromName(roster, nameToAthleteId, parsed.name_raw);
      if (!athleteId) {
        audienceSkipped(
          summary,
          failures,
          rowIndex,
          reason ?? "Could not resolve athlete."
        );
        continue;
      }

      const count = parsed.ig_audience_count ?? 0;
      const following = parsed.current_ig_following;
      const ig_audience_percent =
        count >= 0 && following != null && following > 0
          ? resolveAudiencePercentFraction(parsed.ig_audience_percent ?? 0, count, following)
          : parsed.ig_audience_percent;

      staged.push({
        rowIndex,
        parsed,
        payload: {
          athlete_id: athleteId,
          talent_id: parsed.talent_id,
          name_raw: parsed.name_raw,
          audience_category: parsed.audience_category,
          audience_name: parsed.audience_name,
          ig_audience_percent,
          ig_audience_count: parsed.ig_audience_count,
          current_ig_following: parsed.current_ig_following,
          source_file_name: sourceFileName,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (e: unknown) {
      summary.failed++;
      failures.push({
        sheet: "Audience Data",
        rowIndex,
        reason: e instanceof Error ? e.message : "Unexpected error while processing row",
      });
    } finally {
      onRowDone?.();
    }
  }

  await upsertChunks(
    supabase,
    "athlete_audience_data",
    staged.map((s) => s.payload),
    "athlete_id,audience_category,audience_name",
    audienceConflictKey,
    existingKeys,
    summary,
    failures,
    "Audience Data"
  );
}

function audienceSkipped(
  summary: SheetImportSummary,
  failures: ImportRowFailure[],
  rowIndex: number,
  reason: string
) {
  summary.skipped++;
  failures.push({ sheet: "Audience Data", rowIndex, reason });
}
