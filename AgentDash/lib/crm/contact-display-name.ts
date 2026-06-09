/** Placeholder last names stored when Apollo search omits a full last name. */
const PLACEHOLDER_LAST_NAMES = new Set(["—", ".", ""]);

export function formatContactDisplayName(firstName: string, lastName: string): string {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();
  if (!first) return last;
  if (!last || PLACEHOLDER_LAST_NAMES.has(last)) return first;
  return `${first} ${last}`;
}

/** DB requires NOT NULL last_name; use obfuscated hint from search or minimal placeholder. */
export function apolloLastNameForStorage(fullLastName: string, obfuscatedLastName?: string): string {
  const full = String(fullLastName ?? "").trim();
  if (full && !PLACEHOLDER_LAST_NAMES.has(full)) return full;
  const obfuscated = String(obfuscatedLastName ?? "").trim();
  if (obfuscated) return obfuscated;
  return ".";
}

export function isPlaceholderLastName(lastName: string): boolean {
  return PLACEHOLDER_LAST_NAMES.has(String(lastName ?? "").trim());
}
