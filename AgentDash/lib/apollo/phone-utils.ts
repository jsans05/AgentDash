function str(v: unknown): string | null {
  const s = v != null ? String(v).trim() : "";
  return s || null;
}

function phoneFromObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const p = obj as Record<string, unknown>;
  return str(p.sanitized_number) ?? str(p.sanitized_phone) ?? str(p.number) ?? str(p.raw_number);
}

/** Extract corporate / HQ phone from an Apollo organization enrich payload. */
export function extractOrgPhone(org: Record<string, unknown>): string | null {
  const fromPrimary = phoneFromObject(org.primary_phone);
  if (fromPrimary) return fromPrimary;

  const phone = org.phone;
  if (typeof phone === "string") return str(phone);
  const fromPhone = phoneFromObject(phone);
  if (fromPhone) return fromPhone;

  return str(org.sanitized_phone);
}

export type ApolloPhoneNumberEntry = {
  type_cd?: string;
  sanitized_number?: string;
  raw_number?: string;
  confidence_cd?: string;
};

/** Prefer mobile, then high-confidence, then first available number. */
export function pickBestContactPhone(phones: ApolloPhoneNumberEntry[]): string | null {
  if (!phones.length) return null;

  const mobile = phones.find((p) => p.type_cd === "mobile");
  if (mobile) return str(mobile.sanitized_number) ?? str(mobile.raw_number);

  const high = phones.find((p) => p.confidence_cd === "high");
  if (high) return str(high.sanitized_number) ?? str(high.raw_number);

  const first = phones[0];
  return str(first?.sanitized_number) ?? str(first?.raw_number);
}

/** Work phone returned synchronously from people/match when reveal_phone_number is set. */
export function extractPersonSyncPhone(person: Record<string, unknown> | null | undefined): string | null {
  if (!person || typeof person !== "object") return null;

  const direct = str(person.phone) ?? str(person.sanitized_phone);
  if (direct) return direct;

  if (Array.isArray(person.phone_numbers)) {
    const picked = pickBestContactPhone(person.phone_numbers as ApolloPhoneNumberEntry[]);
    if (picked) return picked;
  }

  const org = person.organization;
  if (org && typeof org === "object") {
    return extractOrgPhone(org as Record<string, unknown>);
  }

  return null;
}
