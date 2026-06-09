import {
  firstLastKey,
  isEmptyLastName,
  organizationKey,
  splitName,
  tokensFromAthleteRow,
  tokensFromImportName,
  tokensSubsetMatch,
  type NameMatchCandidate,
  type NameResolution,
} from "@/lib/import/name-match";

export function formatAmbiguousNameReason(
  displayName: string,
  candidates: NameMatchCandidate[] | undefined
): string {
  if (!candidates?.length) {
    return `Multiple roster athletes match "${displayName}". Resolve duplicates on the roster first.`;
  }
  const list = candidates
    .map((c) => {
      const label = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || displayName;
      return `${label} (id ${c.athlete_id.slice(0, 8)}…)`;
    })
    .join("; ");
  return `Multiple roster athletes match "${displayName}": ${list}. Keep one profile and remove or rename the other, then re-import.`;
}
import type { createServiceRoleClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServiceRoleClient>>;

type CachedAthlete = {
  athlete_id: string;
  first_name: string;
  last_name: string;
  tokens: string[];
};

const PAGE_SIZE = 1000;

export class AthleteRosterCache {
  private byFirstLast = new Map<string, CachedAthlete[]>();
  /** Athletes with no last name (properties, brands, events). Key = normalized full display name. */
  private byOrganization = new Map<string, CachedAthlete[]>();

  static async load(supabase: Supabase): Promise<AthleteRosterCache> {
    const cache = new AthleteRosterCache();
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("athletes")
        .select("athlete_id, first_name, last_name")
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`Failed to load athletes: ${error.message}`);
      const rows = data ?? [];
      for (const row of rows) {
        cache.addRow(row.athlete_id, row.first_name, row.last_name);
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return cache;
  }

  private addRow(athlete_id: string, first_name: string | null, last_name: string | null) {
    const first = (first_name ?? "").trim();
    const last = (last_name ?? "").trim();

    const entry: CachedAthlete = {
      athlete_id,
      first_name: first,
      last_name: last,
      tokens: tokensFromAthleteRow(first_name, last_name),
    };

    if (isEmptyLastName(last)) {
      const orgKey = organizationKey(first);
      if (!orgKey) return;
      const orgList = this.byOrganization.get(orgKey) ?? [];
      orgList.push(entry);
      this.byOrganization.set(orgKey, orgList);
      return;
    }

    const key = firstLastKey(entry.tokens);
    if (!key) return;

    const list = this.byFirstLast.get(key) ?? [];
    list.push(entry);
    this.byFirstLast.set(key, list);
  }

  private toCandidates(matches: CachedAthlete[]): NameResolution["candidates"] {
    return matches.map((m) => ({
      athlete_id: m.athlete_id,
      first_name: m.first_name,
      last_name: m.last_name,
    }));
  }

  resolveOrganization(displayName: string): NameResolution {
    const key = organizationKey(displayName);
    if (!key) return { athlete_id: null, ambiguous: false };

    const matches = this.byOrganization.get(key) ?? [];
    if (matches.length === 1) return { athlete_id: matches[0]!.athlete_id, ambiguous: false };
    if (matches.length === 0) return { athlete_id: null, ambiguous: false };
    return { athlete_id: null, ambiguous: true, candidates: this.toCandidates(matches) };
  }

  resolveByName(rawName: string): NameResolution {
    const trimmed = rawName.trim();
    if (!trimmed) return { athlete_id: null, ambiguous: false };

    const orgMatch = this.resolveOrganization(trimmed);
    if (orgMatch.athlete_id || orgMatch.ambiguous) return orgMatch;

    const tokens = tokensFromImportName(trimmed);
    const key = firstLastKey(tokens);
    if (!key) return { athlete_id: null, ambiguous: false };

    const candidates = this.byFirstLast.get(key) ?? [];
    const matches = candidates.filter((c) => tokensSubsetMatch(tokens, c.tokens));

    if (matches.length === 1) return { athlete_id: matches[0]!.athlete_id, ambiguous: false };
    if (matches.length === 0) return { athlete_id: null, ambiguous: false };
    return { athlete_id: null, ambiguous: true, candidates: this.toCandidates(matches) };
  }

  resolveByFirstLast(firstName: string, lastName: string): NameResolution {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!last) return this.resolveOrganization(first);
    return this.resolveByName(`${first} ${last}`);
  }

  /** Register a newly created athlete so later rows in the same import can match. */
  register(athlete_id: string, first_name: string, last_name: string) {
    this.addRow(athlete_id, first_name, last_name);
  }

  /**
   * Resolve name or create athlete. Updates cache on create.
   * Returns null if ambiguous or insert failed.
   */
  async ensureByName(supabase: Supabase, rawName: string): Promise<string | null> {
    const name = rawName.trim();
    if (!name) return null;

    const resolution = this.resolveByName(name);
    if (resolution.athlete_id) return resolution.athlete_id;
    if (resolution.ambiguous) return null;

    const { first_name, last_name } = splitName(name);
    const athleteId = await this.insertAthlete(supabase, first_name, last_name);
    if (athleteId) this.register(athleteId, first_name, last_name);
    return athleteId;
  }

  /** Batch-create athletes for names that are missing (non-ambiguous). */
  async ensureManyByName(
    supabase: Supabase,
    names: Iterable<string>
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set([...names].map((n) => n.trim()).filter(Boolean))];
    const result = new Map<string, string | null>();

    const toCreate: { name: string; first_name: string; last_name: string }[] = [];
    for (const name of unique) {
      const resolution = this.resolveByName(name);
      if (resolution.athlete_id) {
        result.set(name, resolution.athlete_id);
        continue;
      }
      if (resolution.ambiguous) {
        result.set(name, null);
        continue;
      }
      const { first_name, last_name } = splitName(name);
      toCreate.push({ name, first_name, last_name });
    }

    const CHUNK = 100;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const chunk = toCreate.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("athletes")
        .insert(
          chunk.map(({ first_name, last_name }) => ({
            first_name,
            last_name,
            sport: null,
            current_agent_id: null,
            city: null,
            state: null,
            country: null,
            accolades: [],
          }))
        )
        .select("athlete_id, first_name, last_name");

      if (error) {
        for (const row of chunk) result.set(row.name, null);
        continue;
      }

      for (const row of data ?? []) {
        this.register(row.athlete_id, row.first_name, row.last_name);
      }
      for (const item of chunk) {
        const resolution = this.resolveByName(item.name);
        result.set(item.name, resolution.athlete_id);
      }
    }

    return result;
  }

  async insertAthletePublic(
    supabase: Supabase,
    fields: {
      first_name: string;
      last_name: string;
      sport: string | null;
      country: string | null;
      current_agent_id: string | null;
    }
  ): Promise<string | null> {
    const { data, error } = await supabase
      .from("athletes")
      .insert({
        first_name: fields.first_name,
        last_name: fields.last_name,
        sport: fields.sport,
        current_agent_id: fields.current_agent_id,
        country: fields.country,
        city: null,
        state: null,
        accolades: [],
      })
      .select("athlete_id")
      .single();

    if (error) return null;
    const athleteId = data?.athlete_id ?? null;
    if (athleteId) this.register(athleteId, fields.first_name, fields.last_name);
    return athleteId;
  }

  private async insertAthlete(
    supabase: Supabase,
    first_name: string,
    last_name: string
  ): Promise<string | null> {
    return this.insertAthletePublic(supabase, {
      first_name,
      last_name,
      sport: null,
      country: null,
      current_agent_id: null,
    });
  }
}
