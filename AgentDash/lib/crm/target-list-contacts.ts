import type { ApolloRevealStatus } from "@/components/crm/ApolloContactActions";

export type TargetListContactShape = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: ApolloRevealStatus;
  apollo_phone_reveal_status: "pending" | "revealed" | null;
  outreach_email_subject?: string | null;
  outreach_email?: string | null;
  email_drafts?: unknown;
};

export function mapApiContactToTargetList(raw: Record<string, unknown>): TargetListContactShape {
  const status = raw.apollo_reveal_status;
  const phoneStatus = raw.apollo_phone_reveal_status;
  return {
    contact_id: String(raw.contact_id ?? ""),
    first_name: String(raw.first_name ?? ""),
    last_name: String(raw.last_name ?? ""),
    role: raw.role != null ? String(raw.role) : null,
    email: raw.email != null ? String(raw.email) : null,
    phone: raw.phone != null ? String(raw.phone) : null,
    notes: raw.notes != null ? String(raw.notes) : null,
    linkedin_url: raw.linkedin_url != null ? String(raw.linkedin_url) : null,
    apollo_person_id: raw.apollo_person_id != null ? String(raw.apollo_person_id) : null,
    apollo_reveal_status:
      status === "pending" || status === "revealed" ? status : null,
    apollo_phone_reveal_status:
      phoneStatus === "pending" || phoneStatus === "revealed" ? phoneStatus : null,
    outreach_email_subject: null,
    outreach_email: null,
    email_drafts: raw.email_drafts ?? [],
  };
}

export function mergeCompanyContactsIntoRows<T extends { company_id: string; contacts: TargetListContactShape[] }>(
  rows: T[],
  companyId: string,
  contacts: TargetListContactShape[]
): T[] {
  return rows.map((row) =>
    row.company_id === companyId ? { ...row, contacts: contacts.map((c) => ({ ...c })) } : row
  );
}

export function isDeletableTargetListContact(c: TargetListContactShape): boolean {
  const isApollo =
    c.apollo_reveal_status === "pending" || c.apollo_reveal_status === "revealed";
  return isApollo && !String(c.outreach_email ?? "").trim();
}

export function removeContactFromRows<T extends { contacts: TargetListContactShape[] }>(
  rows: T[],
  contactId: string
): T[] {
  return rows.map((row) => ({
    ...row,
    contacts: row.contacts.filter((c) => c.contact_id !== contactId),
  }));
}

export function removeContactsFromRows<T extends { contacts: TargetListContactShape[] }>(
  rows: T[],
  contactIds: Set<string>
): T[] {
  if (contactIds.size === 0) return rows;
  return rows.map((row) => ({
    ...row,
    contacts: row.contacts.filter((c) => !contactIds.has(c.contact_id)),
  }));
}

export function patchContactInRows<T extends { contacts: TargetListContactShape[] }>(
  rows: T[],
  contactId: string,
  patch: Partial<TargetListContactShape>
): T[] {
  return rows.map((row) => ({
    ...row,
    contacts: row.contacts.map((c) =>
      c.contact_id === contactId ? { ...c, ...patch } : c
    ),
  }));
}
