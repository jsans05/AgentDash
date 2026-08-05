import { normalizeForNameMatch } from "@/lib/import/name-match";

/**
 * Company / brand names that must not be created or imported.
 * Matching uses normalizeForNameMatch (casefold, punctuation stripped).
 * Add display-name forms here; variants like "Gorilla-RX Wellness" still match.
 */
export const BLOCKED_COMPANY_NAMES = [
  "Gorilla RX Wellness",
] as const;

const BLOCKED_NORMALIZED = new Set(
  BLOCKED_COMPANY_NAMES.map((name) => normalizeForNameMatch(name)).filter(Boolean)
);

export class BlockedCompanyNameError extends Error {
  readonly companyName: string;

  constructor(companyName: string) {
    super(`Blocked company name: ${companyName}`);
    this.name = "BlockedCompanyNameError";
    this.companyName = companyName;
  }
}

export function isBlockedCompanyName(raw: string | null | undefined): boolean {
  const key = normalizeForNameMatch(String(raw ?? ""));
  if (!key) return false;
  return BLOCKED_NORMALIZED.has(key);
}

/** Throws if the name is on the import/create denylist. */
export function assertNotBlockedCompanyName(raw: string | null | undefined): void {
  const name = String(raw ?? "").trim();
  if (isBlockedCompanyName(name)) {
    throw new BlockedCompanyNameError(name);
  }
}
