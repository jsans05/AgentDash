export type NameMatchCandidate = {
  athlete_id: string;
  first_name: string;
  last_name: string;
};

export type NameResolution = {
  athlete_id: string | null;
  ambiguous: boolean;
  candidates?: NameMatchCandidate[];
};

export function normalizeForNameMatch(raw: string): string {
  const lowered = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const noParen = lowered.replace(/\([^)]*\)/g, " ");
  return noParen
    .replace(/[\"'’`]/g, " ")
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokensFromImportName(rawName: string): string[] {
  if (rawName.includes(",")) {
    const [lastPart, ...rest] = rawName.split(",");
    const firstPart = rest.join(",");
    const swapped = normalizeForNameMatch(`${firstPart} ${lastPart}`);
    return swapped ? swapped.split(" ").filter(Boolean) : [];
  }

  const normalized = normalizeForNameMatch(rawName);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export function tokensFromAthleteRow(firstName: string | null, lastName: string | null): string[] {
  return tokensFromImportName(`${firstName ?? ""} ${lastName ?? ""}`);
}

export function tokensSubsetMatch(aTokens: string[], bTokens: string[]): boolean {
  if (aTokens.length < 2 || bTokens.length < 2) return false;

  const aFirst = aTokens[0];
  const aLast = aTokens[aTokens.length - 1];
  const bFirst = bTokens[0];
  const bLast = bTokens[bTokens.length - 1];

  if (aFirst !== bFirst || aLast !== bLast) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  const aSubsetB = [...aSet].every((t) => bSet.has(t));
  const bSubsetA = [...bSet].every((t) => aSet.has(t));
  return aSubsetB || bSubsetA;
}

export function firstLastKey(tokens: string[]): string | null {
  if (tokens.length < 2) return null;
  return `${tokens[0]}|${tokens[tokens.length - 1]}`;
}

/** Stable key for properties / orgs stored with an empty last name. */
export function organizationKey(displayName: string): string {
  return normalizeForNameMatch(displayName);
}

export function isEmptyLastName(lastName: string | null | undefined): boolean {
  return !(lastName ?? "").trim();
}

export function splitName(raw: string | null | undefined): { first_name: string; last_name: string } {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return { first_name: "Unknown", last_name: "" };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) {
    return { first_name: parts[0] ?? "Unknown", last_name: "" };
  }
  const first_name = parts[0] ?? "";
  const last_name = parts.slice(1).join(" ");
  return { first_name, last_name };
}
