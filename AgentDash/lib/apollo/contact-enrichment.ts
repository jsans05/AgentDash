/** Whether Apollo people/match can run for this CRM contact (Apollo-found or uploaded). */
export function canEnrichContactViaApollo(contact: {
  apollo_person_id?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): boolean {
  if (contact.apollo_person_id) return true;
  const email = String(contact.email ?? "").trim();
  if (email.includes("@")) return true;
  const linkedin = String(contact.linkedin_url ?? "").trim();
  if (linkedin.includes("linkedin.com")) return true;
  const first = String(contact.first_name ?? "").trim();
  const last = String(contact.last_name ?? "").trim();
  return Boolean(first && last && last !== "—");
}
