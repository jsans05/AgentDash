import type { ApolloContactSearchOverrides } from "@/lib/apollo/search-defaults";

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((v) => String(v).trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Parse Apollo contact-search filters from a JSON request body. */
export function parseContactSearchOverridesFromBody(
  body: Record<string, unknown>
): ApolloContactSearchOverrides {
  const overrides: ApolloContactSearchOverrides = {};

  const organizationLocations = readStringArray(body.organization_locations);
  if (organizationLocations) overrides.organization_locations = organizationLocations;

  const personLocations = readStringArray(body.person_locations);
  if (personLocations) overrides.person_locations = personLocations;

  const personTitles = readStringArray(body.person_titles);
  if (personTitles) overrides.person_titles = personTitles;

  const personSeniorities = readStringArray(body.person_seniorities);
  if (personSeniorities) overrides.person_seniorities = personSeniorities;

  if (typeof body.q_keywords === "string" && body.q_keywords.trim()) {
    overrides.q_keywords = body.q_keywords.trim();
  }

  const revenueRange =
    body.revenue_range && typeof body.revenue_range === "object"
      ? (body.revenue_range as { min?: unknown; max?: unknown })
      : null;
  if (revenueRange) {
    const min = revenueRange.min != null ? Number(revenueRange.min) : undefined;
    const max = revenueRange.max != null ? Number(revenueRange.max) : undefined;
    if ((min != null && Number.isFinite(min)) || (max != null && Number.isFinite(max))) {
      overrides.revenue_range = {};
      if (min != null && Number.isFinite(min)) overrides.revenue_range.min = min;
      if (max != null && Number.isFinite(max)) overrides.revenue_range.max = max;
    }
  }

  if (body.page != null) {
    const page = Number(body.page);
    if (Number.isFinite(page) && page >= 1) overrides.page = page;
  }

  return overrides;
}

/** Serialize contact-search overrides for POST /find-contacts and bulk routes. */
export function contactSearchOverridesToRequestBody(
  overrides?: ApolloContactSearchOverrides
): Record<string, unknown> {
  if (!overrides) return {};
  const body: Record<string, unknown> = {};
  if (overrides.organization_locations?.length) {
    body.organization_locations = overrides.organization_locations;
  }
  if (overrides.person_locations?.length) body.person_locations = overrides.person_locations;
  if (overrides.person_titles?.length) body.person_titles = overrides.person_titles;
  if (overrides.person_seniorities?.length) body.person_seniorities = overrides.person_seniorities;
  if (overrides.q_keywords?.trim()) body.q_keywords = overrides.q_keywords.trim();
  if (overrides.revenue_range?.min != null) {
    body.revenue_range = { ...(body.revenue_range as object), min: overrides.revenue_range.min };
  }
  if (overrides.revenue_range?.max != null) {
    body.revenue_range = { ...(body.revenue_range as object), max: overrides.revenue_range.max };
  }
  if (overrides.page != null) body.page = overrides.page;
  return body;
}
