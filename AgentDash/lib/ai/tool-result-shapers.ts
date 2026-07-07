/** Trim bulky tool JSON before re-injection into the model context. */

const DEFAULT_TOP_N = 20;

function topRows<T>(rows: T[] | undefined | null, limit = DEFAULT_TOP_N): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit);
}

function trimNamedPercentRows(
  rows: Array<{ name?: string; ig_audience_percent?: number; ig_audience_count?: number; value?: string; cohort?: string }> | undefined,
  limit = DEFAULT_TOP_N
) {
  return topRows(rows, limit).map((r) => ({
    ...(r.name != null ? { name: r.name } : {}),
    ...(r.value != null ? { value: r.value } : {}),
    ...(r.cohort != null ? { cohort: r.cohort } : {}),
    ig_audience_percent: r.ig_audience_percent,
  }));
}

function shapeAthleteFullAudienceProfile(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  return {
    athlete_id: r.athlete_id,
    athlete_name: r.athlete_name,
    social: r.social,
    interests: trimNamedPercentRows(r.interests as any),
    gender: trimNamedPercentRows(r.gender as any),
    age: trimNamedPercentRows(r.age as any),
    ethnicity: trimNamedPercentRows(r.ethnicity as any),
    countries: trimNamedPercentRows(r.countries as any),
    brands: trimNamedPercentRows(r.brands as any),
  };
}

function shapeAthleteIntelligence(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  const athlete = r.athlete as Record<string, unknown> | undefined;
  const contracts = r.contracts as Record<string, unknown[]> | undefined;
  const audience = r.audience_data as Record<string, unknown> | undefined;
  const summary = audience?.summary as Record<string, unknown> | undefined;

  const slimContract = (c: Record<string, unknown>) => ({
    contract_id: c.contract_id,
    company_id: c.company_id,
    category: c.category,
    status: c.status,
    start_date: c.start_date,
    end_date: c.end_date,
  });

  return {
    athlete: athlete
      ? {
          athlete_id: athlete.athlete_id,
          first_name: athlete.first_name,
          last_name: athlete.last_name,
          sport: athlete.sport,
          gender: athlete.gender,
        }
      : null,
    contracts: contracts
      ? {
          current: topRows(contracts.current, 10).map((c) => slimContract(c as Record<string, unknown>)),
          upcoming: topRows(contracts.upcoming, 5).map((c) => slimContract(c as Record<string, unknown>)),
          expired_count: Array.isArray(contracts.expired) ? contracts.expired.length : 0,
        }
      : undefined,
    audience_data: summary
      ? {
          summary: {
            interests: trimNamedPercentRows(summary.interests as any),
            gender: trimNamedPercentRows(summary.gender as any),
            age: trimNamedPercentRows(summary.age as any),
            countries: trimNamedPercentRows(summary.countries as any),
            brands: trimNamedPercentRows(summary.brands as any),
          },
        }
      : audience,
    conflicts: r.conflicts,
    notes: Array.isArray(r.notes) ? (r.notes as string[]).slice(0, 8) : r.notes,
  };
}

function shapeGenerateAthleteProspectList(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return result;
  return {
    ok: r.ok,
    athlete: r.athlete,
    markdown: r.markdown,
    categories_searched: r.categories_searched,
    prioritized_categories: r.prioritized_categories,
    blocked_companies: topRows(r.blocked_companies as string[], 30),
  };
}

function shapeAthleteTargetList(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return result;
  const rows = Array.isArray(r.rows) ? r.rows : [];
  return {
    ok: r.ok,
    athlete: r.athlete,
    row_count: r.row_count,
    rows: rows.map((row: any) => ({
      pipeline_id: row.pipeline_id,
      company_id: row.company_id,
      company_name: row.company_name,
      category: row.category,
      match_score: row.match_score,
      website: row.website,
      hq_phone: row.hq_phone,
      has_outreach_email: Boolean(row.outreach_email?.trim?.() ?? row.outreach_email),
      outreach_email_subject: row.outreach_email_subject,
      contact_count: row.contact_count ?? (Array.isArray(row.contacts) ? row.contacts.length : undefined),
      ...(Array.isArray(row.contacts)
        ? {
            contacts: row.contacts.map((c: any) => ({
              contact_id: c.contact_id,
              first_name: c.first_name,
              last_name: c.last_name,
              role: c.role,
              email: c.email,
            })),
          }
        : {}),
    })),
  };
}

function shapeBulkImportCompanies(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return result;
  const results = Array.isArray(r.results) ? r.results : [];
  const failed = results.filter((row: any) => row.error);
  const succeeded = results.filter((row: any) => !row.error).length;
  return {
    ok: r.ok,
    athlete: r.athlete,
    summary: r.summary,
    succeeded_count: succeeded,
    failed_rows: failed.slice(0, 25),
  };
}

const SHAPERS: Record<string, (result: unknown) => unknown> = {
  getAthleteFullAudienceProfile: shapeAthleteFullAudienceProfile,
  getAthleteIntelligence: shapeAthleteIntelligence,
  generateAthleteProspectList: shapeGenerateAthleteProspectList,
  getAthleteTargetList: shapeAthleteTargetList,
  bulkImportCompaniesToCrmForAthlete: shapeBulkImportCompanies,
};

export function shapeToolResultForModel(toolName: string, result: unknown): unknown {
  const shaper = SHAPERS[toolName];
  if (!shaper) return result;
  try {
    return shaper(result);
  } catch {
    return result;
  }
}

export function stringifyToolResultForModel(
  toolName: string,
  result: unknown,
  maxChars = 20_000
): string {
  const shaped = shapeToolResultForModel(toolName, result);
  const rawJson = JSON.stringify(shaped);
  if (rawJson.length <= maxChars) return rawJson;
  return `${rawJson.slice(0, maxChars)}\n...(truncated)`;
}
