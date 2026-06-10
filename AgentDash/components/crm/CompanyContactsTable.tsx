"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApolloRevealStatus } from "@/components/crm/ApolloContactActions";
import { ApolloFindContactsInline } from "@/components/crm/ApolloFindContactsInline";
import { ContactEmailCell } from "@/components/crm/ContactEmailCell";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import { mapApiContactToTargetList } from "@/lib/crm/target-list-contacts";

export type CompanyContactRow = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: ApolloRevealStatus;
};

function mapRows(apiContacts: unknown[]): CompanyContactRow[] {
  return (Array.isArray(apiContacts) ? apiContacts : []).map((c) => {
    const m = mapApiContactToTargetList(c as Record<string, unknown>);
    return {
      contact_id: m.contact_id,
      first_name: m.first_name,
      last_name: m.last_name,
      role: m.role,
      email: m.email,
      linkedin_url: m.linkedin_url,
      apollo_person_id: m.apollo_person_id,
      apollo_reveal_status: m.apollo_reveal_status,
    };
  });
}

export function CompanyContactsTable({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [contacts, setContacts] = useState<CompanyContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/contacts`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load contacts");
      setContacts(mapRows(data.contacts));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchContact(contactId: string, patch: Partial<CompanyContactRow>) {
    setContacts((prev) => prev.map((c) => (c.contact_id === contactId ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">
          Contacts ({companyName})
        </span>
        <ApolloFindContactsInline
          companyId={companyId}
          companyName={companyName}
          onContacts={(apiContacts) => {
            setError(null);
            setContacts(mapRows(apiContacts));
          }}
          onError={(msg) => setError(msg)}
        />
      </div>

      {error ? <p className="text-xs text-[#F1A2A2]">{error}</p> : null}
      {loading ? (
        <p className="text-xs text-[#B9B2A6]">Loading contacts…</p>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-[#B9B2A6]">No contacts yet. Use Find contacts to search Apollo.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-xs">
            <thead className="bg-[#1A211D] text-[#B9B2A6]">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Name</th>
                <th className="px-2 py-1.5 text-left font-medium">Role</th>
                <th className="px-2 py-1.5 text-left font-medium">Email</th>
                <th className="px-2 py-1.5 text-left font-medium">LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const name = formatContactDisplayName(c.first_name, c.last_name);
                const isApollo =
                  c.apollo_reveal_status === "pending" || c.apollo_reveal_status === "revealed";
                return (
                  <tr key={c.contact_id} className="border-t border-white/10">
                    <td className="px-2 py-1.5 text-[#ECE7DF]">{name || "—"}</td>
                    <td className="px-2 py-1.5 text-[#D7D0C4]">{c.role || "—"}</td>
                    <td className="px-2 py-1.5">
                      {isApollo ? (
                        <ContactEmailCell
                          contactId={c.contact_id}
                          email={c.email}
                          apolloRevealStatus={c.apollo_reveal_status}
                          onRevealed={(updated) => {
                            patchContact(c.contact_id, {
                              email: (updated.email as string) ?? c.email,
                              linkedin_url: (updated.linkedin_url as string) ?? c.linkedin_url,
                              apollo_reveal_status: "revealed",
                              first_name: (updated.first_name as string) ?? c.first_name,
                              last_name: (updated.last_name as string) ?? c.last_name,
                              role: (updated.role as string) ?? c.role,
                            });
                          }}
                          onDeleted={() => {
                            setContacts((prev) => prev.filter((x) => x.contact_id !== c.contact_id));
                          }}
                        />
                      ) : c.email ? (
                        <a href={`mailto:${c.email}`} className="text-[#CEE4D4] hover:underline">
                          {c.email}
                        </a>
                      ) : (
                        <span className="text-[#8E877A]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <ContactLinkedinCell linkedinUrl={c.linkedin_url} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
