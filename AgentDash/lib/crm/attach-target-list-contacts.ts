export function ownerCompanyKey(ownerId: string, companyId: string): string {
  return `${ownerId}::${companyId}`;
}

export function leftoverContactIdsToAdopt(
  ownerCompanyPairs: { owner_id: string; company_id: string }[],
  contacts: { contact_id: string; company_id: string; created_by_user_id: string }[]
): Map<string, string[]> {
  const ownersByCompany = new Map<string, Set<string>>();
  for (const pair of ownerCompanyPairs) {
    const set = ownersByCompany.get(pair.company_id) ?? new Set<string>();
    set.add(pair.owner_id);
    ownersByCompany.set(pair.company_id, set);
  }

  const contactIdsByOwnerCompany = new Map<string, string[]>();
  for (const contact of contacts) {
    const key = ownerCompanyKey(contact.created_by_user_id, contact.company_id);
    const list = contactIdsByOwnerCompany.get(key) ?? [];
    list.push(contact.contact_id);
    contactIdsByOwnerCompany.set(key, list);
  }

  const adoptByOwner = new Map<string, string[]>();
  for (const [companyId, owners] of ownersByCompany) {
    if (owners.size !== 1) continue;
    const ownerId = [...owners][0];
    if (!ownerId) continue;
    const owned = contactIdsByOwnerCompany.get(ownerCompanyKey(ownerId, companyId));
    if (owned && owned.length > 0) continue;

    const leftoverIds: string[] = [];
    for (const [key, ids] of contactIdsByOwnerCompany) {
      if (!key.endsWith(`::${companyId}`)) continue;
      const leftoverOwner = key.slice(0, key.length - companyId.length - 2);
      if (owners.has(leftoverOwner)) continue;
      leftoverIds.push(...ids);
    }
    if (leftoverIds.length === 0) continue;
    const existing = adoptByOwner.get(ownerId) ?? [];
    existing.push(...leftoverIds);
    adoptByOwner.set(ownerId, existing);
  }
  return adoptByOwner;
}

/**
 * After assignment, contacts can remain on the previous owner while the
 * pipeline card belongs to a teammate. Copy those leftover contacts onto any
 * current owner who has none for that company so the shared target list still
 * shows role / email / LinkedIn / phone.
 */
export function applyLeftoverContactsToEmptyOwners<T>(
  ownerCompanyPairs: { owner_id: string; company_id: string }[],
  contactsByOwnerCompany: Map<string, T[]>
): void {
  const ownersByCompany = new Map<string, Set<string>>();
  for (const pair of ownerCompanyPairs) {
    const set = ownersByCompany.get(pair.company_id) ?? new Set<string>();
    set.add(pair.owner_id);
    ownersByCompany.set(pair.company_id, set);
  }

  const leftoverByCompany = new Map<string, T[]>();
  for (const [key, contacts] of contactsByOwnerCompany) {
    const sep = key.indexOf("::");
    if (sep <= 0) continue;
    const ownerId = key.slice(0, sep);
    const companyId = key.slice(sep + 2);
    if (ownersByCompany.get(companyId)?.has(ownerId)) continue;
    const list = leftoverByCompany.get(companyId) ?? [];
    list.push(...contacts);
    leftoverByCompany.set(companyId, list);
  }

  for (const pair of ownerCompanyPairs) {
    const key = ownerCompanyKey(pair.owner_id, pair.company_id);
    const existing = contactsByOwnerCompany.get(key);
    if (existing && existing.length > 0) continue;
    const leftovers = leftoverByCompany.get(pair.company_id);
    if (!leftovers?.length) continue;
    contactsByOwnerCompany.set(key, leftovers);
  }
}
