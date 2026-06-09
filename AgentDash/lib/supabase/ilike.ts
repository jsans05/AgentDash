export function escapeForIlike(value: string): string {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function ilikeContains(value: string): string {
  return `%${escapeForIlike(String(value ?? "").trim())}%`;
}

/**
 * PostgREST `.or(...)` uses commas to delimit predicates.
 * Strip commas from user fragments before interpolating in `.or` filters.
 */
export function normalizeOrIlikeFragment(value: string): string {
  return escapeForIlike(String(value ?? "").trim().replace(/,/g, " "));
}
