import { isPlaceholderLastName } from "@/lib/crm/contact-display-name";
import type { TargetListContactShape } from "@/lib/crm/target-list-contacts";

type NameFields = Pick<TargetListContactShape, "first_name" | "last_name">;

function normalizeFirstName(firstName: string): string {
  return String(firstName ?? "").trim().toLowerCase();
}

/** First 2 letters of last name — matches full names to Apollo obfuscated hints (e.g. McCarthy vs Mc***y). */
function lastNameFingerprint(lastName: string): string {
  const letters = String(lastName ?? "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z]/g, "");
  return letters.slice(0, 2);
}

export function contactLastNamesLikelyMatch(a: string, b: string): boolean {
  const left = String(a ?? "").trim().toLowerCase();
  const right = String(b ?? "").trim().toLowerCase();
  if (!left || !right) return left === right;
  if (left === right) return true;

  const fpA = lastNameFingerprint(left);
  const fpB = lastNameFingerprint(right);
  if (fpA.length >= 2 && fpB.length >= 2 && fpA === fpB) return true;

  const cleanA = left.replace(/\*/g, "");
  const cleanB = right.replace(/\*/g, "");
  const shorter = cleanA.length <= cleanB.length ? cleanA : cleanB;
  const longer = cleanA.length <= cleanB.length ? cleanB : cleanA;
  if (shorter.length >= 2 && longer.startsWith(shorter.slice(0, Math.min(3, shorter.length)))) {
    return true;
  }

  return false;
}

export function contactsLikelySamePerson(a: NameFields, b: NameFields): boolean {
  if (normalizeFirstName(a.first_name) !== normalizeFirstName(b.first_name)) return false;
  return contactLastNamesLikelyMatch(a.last_name, b.last_name);
}

function contactHasOutreachDraft(contact: TargetListContactShape): boolean {
  return Boolean(String(contact.outreach_email ?? "").trim());
}

/** Higher score = prefer keeping this row when deduping. */
export function contactRetentionScore(contact: TargetListContactShape): number {
  let score = 0;
  if (contact.apollo_person_id) score += 100;
  if (contact.apollo_reveal_status === "revealed") score += 50;
  if (contact.apollo_reveal_status === "pending") score += 20;
  if (contact.email) score += 30;
  if (contact.linkedin_url) score += 10;
  if (contact.phone) score += 5;
  if (!isPlaceholderLastName(contact.last_name)) score += 5;
  return score;
}

function pickStaleContact(
  a: TargetListContactShape,
  b: TargetListContactShape
): TargetListContactShape | null {
  const scoreA = contactRetentionScore(a);
  const scoreB = contactRetentionScore(b);
  let stale: TargetListContactShape;
  if (scoreA > scoreB) stale = b;
  else if (scoreB > scoreA) stale = a;
  else stale = a.contact_id < b.contact_id ? b : a;

  if (contactHasOutreachDraft(stale)) return null;
  return stale;
}

/** Contact ids that look like older manual/import rows superseded by Apollo-linked matches. */
export function findStaleDuplicateContactIds(contacts: TargetListContactShape[]): string[] {
  const staleIds = new Set<string>();
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]!;
      const b = contacts[j]!;
      if (!contactsLikelySamePerson(a, b)) continue;
      const stale = pickStaleContact(a, b);
      if (stale) staleIds.add(stale.contact_id);
    }
  }
  return [...staleIds];
}

export function isStaleDuplicateContact(
  contact: TargetListContactShape,
  companyContacts: TargetListContactShape[]
): boolean {
  if (contactHasOutreachDraft(contact)) return false;
  return findStaleDuplicateContactIds(companyContacts).includes(contact.contact_id);
}
