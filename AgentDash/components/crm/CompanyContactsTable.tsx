"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Linkedin, Pencil, Trash2, X } from "lucide-react";
import type { ApolloRevealStatus } from "@/components/crm/ApolloContactActions";
import { ApolloFindContactsInline } from "@/components/crm/ApolloFindContactsInline";
import { ContactEmailCell, EmailWithCopy } from "@/components/crm/ContactEmailCell";
import { ContactLinkedinCell } from "@/components/crm/ContactLinkedinCell";
import { ContactPhoneCell } from "@/components/crm/ContactPhoneCell";
import { Button } from "@/components/ui/button";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import { mapApiContactToTargetList } from "@/lib/crm/target-list-contacts";
import type { SequenceContactLifecyclePatch } from "@/components/crm/SequenceContactSelectors";
import { safeHttpUrl } from "@/lib/security/url";

export type CompanyContactRow = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  apollo_person_id: string | null;
  apollo_reveal_status: ApolloRevealStatus;
  apollo_phone_reveal_status: "pending" | "revealed" | null;
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
      phone: m.phone,
      linkedin_url: m.linkedin_url,
      apollo_person_id: m.apollo_person_id,
      apollo_reveal_status: m.apollo_reveal_status,
      apollo_phone_reveal_status: m.apollo_phone_reveal_status,
    };
  });
}

function linkedinHref(raw: string | null | undefined): string | null {
  const u = (raw ?? "").trim();
  if (!u) return null;
  const withProtocol = /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`;
  return safeHttpUrl(withProtocol);
}

const editInputClass =
  "w-full min-w-[8rem] rounded border border-white/15 bg-[#101513] px-1.5 py-1 text-[11px] text-[#ECE7DF] placeholder:text-[#5E574C]";

export function CompanyContactsTable({
  companyId,
  companyName,
  cardId,
  contactOfRecordId,
  sequenceContactId,
  onLifecycle,
  onContactsChange,
  onContactsMutated,
}: {
  companyId: string;
  companyName: string;
  /** When set, deletes go through sequence lifecycle (clears FKs / drops empty company). */
  cardId?: string;
  contactOfRecordId?: string | null;
  sequenceContactId?: string | null;
  onLifecycle?: (patch: SequenceContactLifecyclePatch) => void;
  onContactsChange?: (count: number) => void;
  /** Fired after local contact list changes (delete, Apollo find, move, etc.). */
  onContactsMutated?: () => void;
}) {
  const [contacts, setContacts] = useState<CompanyContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/contacts`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load contacts");
      const rows = mapRows(data.contacts);
      setContacts(rows);
      onContactsChange?.(rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [companyId, onContactsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingPhoneIds = useMemo(
    () =>
      contacts
        .filter((c) => !c.phone && c.apollo_phone_reveal_status === "pending")
        .map((c) => c.contact_id),
    [contacts]
  );

  // Poll Apollo phone reveals that return asynchronously.
  useEffect(() => {
    if (pendingPhoneIds.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      for (const contactId of pendingPhoneIds) {
        try {
          const res = await fetch(`/api/crm/contacts/${contactId}`, { credentials: "include" });
          const data = await res.json().catch(() => ({}));
          const c = data?.contact;
          if (!c || cancelled) continue;
          const status = c.apollo_phone_reveal_status;
          const normalizedStatus =
            status === "pending" || status === "revealed" ? status : null;
          if (c.phone || normalizedStatus !== "pending") {
            setContacts((prev) =>
              prev.map((row) =>
                row.contact_id === contactId
                  ? {
                      ...row,
                      phone: c.phone != null ? String(c.phone) : null,
                      apollo_phone_reveal_status: normalizedStatus,
                    }
                  : row
              )
            );
          }
        } catch {
          /* ignore transient poll errors */
        }
      }
    };
    const id = window.setInterval(() => void tick(), 8000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pendingPhoneIds]);

  function patchContact(contactId: string, patch: Partial<CompanyContactRow>) {
    setContacts((prev) => prev.map((c) => (c.contact_id === contactId ? { ...c, ...patch } : c)));
  }

  const linkedinUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const c of contacts) {
      const href = linkedinHref(c.linkedin_url);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    }
    return urls;
  }, [contacts]);

  function openAllLinkedIn() {
    if (linkedinUrls.length === 0) return;
    for (const url of linkedinUrls) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function startEdit(c: CompanyContactRow) {
    setEditingId(c.contact_id);
    setEditEmail(c.email ?? "");
    setEditPhone(c.phone ?? "");
    setEditCompany(companyName);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditEmail("");
    setEditPhone("");
    setEditCompany("");
  }

  async function saveEdit(contact: CompanyContactRow) {
    const email = editEmail.trim() || null;
    const phone = editPhone.trim() || null;
    const nextCompany = editCompany.trim();
    const moving =
      Boolean(nextCompany) &&
      nextCompany.toLowerCase() !== companyName.trim().toLowerCase();

    if (moving && !window.confirm(`Move ${formatContactDisplayName(contact.first_name, contact.last_name) || "this contact"} to "${nextCompany}"?\n\nThey will leave this company's contact list.`)) {
      return;
    }

    setSavingEdit(true);
    setError(null);
    try {
      // PATCH treats missing role/linkedin as null — always re-send existing values.
      const body: Record<string, unknown> = {
        email,
        phone: phone ?? "",
        role: contact.role,
        linkedin_url: contact.linkedin_url,
      };
      if (moving) body.company_name = nextCompany;

      const res = await fetch(`/api/crm/contacts/${encodeURIComponent(contact.contact_id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save contact");

      if (moving) {
        const next = contacts.filter((x) => x.contact_id !== contact.contact_id);
        setContacts(next);
        onContactsChange?.(next.length);

        const clearPatch: {
          contact_of_record_id?: string | null;
          sequence_contact_id?: string | null;
        } = {};
        if (contactOfRecordId === contact.contact_id) clearPatch.contact_of_record_id = null;
        if (sequenceContactId === contact.contact_id) clearPatch.sequence_contact_id = null;

        if (cardId && Object.keys(clearPatch).length > 0) {
          const pipeRes = await fetch(`/api/crm/pipeline/${encodeURIComponent(cardId)}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(clearPatch),
          });
          const pipeJson = await pipeRes.json().catch(() => ({}));
          if (!pipeRes.ok) {
            throw new Error(pipeJson.error ?? "Contact moved, but failed to clear sequence picks");
          }
        }

        onLifecycle?.({
          deleted_contact_id: contact.contact_id,
          ...clearPatch,
        });
        onContactsMutated?.();
        cancelEdit();
        return;
      }

      patchContact(contact.contact_id, {
        email: data?.contact?.email != null ? String(data.contact.email) : email,
        phone: data?.contact?.phone != null ? String(data.contact.phone) : phone,
      });
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteContact(c: CompanyContactRow) {
    const name = formatContactDisplayName(c.first_name, c.last_name) || "this contact";
    const isLast = contacts.length <= 1;
    const msg = cardId
      ? isLast
        ? `Permanently delete ${name}?\n\nThis is the last contact — the company will also be dropped from your pipeline.`
        : `Permanently delete ${name} from this company? This cannot be undone.`
      : `Permanently delete ${name}? This cannot be undone.`;
    if (!window.confirm(msg)) return;

    setDeletingId(c.contact_id);
    setError(null);
    try {
      if (cardId) {
        const res = await fetch("/api/crm/sequence", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete_contact",
            card_id: cardId,
            contact_id: c.contact_id,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to delete contact");
        onLifecycle?.({
          deleted_contact_id: c.contact_id,
          dropped_company: Boolean(json.dropped_company),
          remaining_contacts: json.remaining_contacts,
          contact_of_record_id:
            json.contact_of_record_id !== undefined ? json.contact_of_record_id : undefined,
          sequence_contact_id:
            json.sequence_contact_id !== undefined ? json.sequence_contact_id : undefined,
          sequence_started_at:
            json.sequence_started_at !== undefined ? json.sequence_started_at : undefined,
          needs_next_contact: Boolean(json.needs_next_contact),
        });
        if (json.dropped_company) return;
        const next = contacts.filter((x) => x.contact_id !== c.contact_id);
        setContacts(next);
        onContactsChange?.(next.length);
        onContactsMutated?.();
      } else {
        const res = await fetch(`/api/crm/contacts/${encodeURIComponent(c.contact_id)}`, {
          method: "DELETE",
          credentials: "include",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to delete contact");
        const next = contacts.filter((x) => x.contact_id !== c.contact_id);
        setContacts(next);
        onContactsChange?.(next.length);
        onContactsMutated?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">
          Contacts ({companyName})
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px]"
            disabled={linkedinUrls.length === 0}
            title={
              linkedinUrls.length === 0
                ? "No LinkedIn URLs on these contacts yet"
                : `Open ${linkedinUrls.length} LinkedIn profile${linkedinUrls.length === 1 ? "" : "s"} in new tabs`
            }
            onClick={openAllLinkedIn}
          >
            <Linkedin className="h-3.5 w-3.5" />
            Open LinkedIns
            {linkedinUrls.length > 0 ? ` (${linkedinUrls.length})` : ""}
          </Button>
          <ApolloFindContactsInline
            companyId={companyId}
            companyName={companyName}
            onContacts={(apiContacts) => {
              setError(null);
              const rows = mapRows(apiContacts);
              setContacts(rows);
              onContactsChange?.(rows.length);
              onContactsMutated?.();
            }}
            onError={(msg) => setError(msg)}
          />
        </div>
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
                <th className="px-2 py-1.5 text-left font-medium">Phone</th>
                <th className="px-2 py-1.5 text-left font-medium">LinkedIn</th>
                <th className="px-2 py-1.5 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const name = formatContactDisplayName(c.first_name, c.last_name);
                const isApollo =
                  c.apollo_reveal_status === "pending" || c.apollo_reveal_status === "revealed";
                const isEditing = editingId === c.contact_id;
                return (
                  <tr key={c.contact_id} className="border-t border-white/10">
                    <td className="px-2 py-1.5 text-[#ECE7DF]">{name || "—"}</td>
                    <td className="px-2 py-1.5 text-[#D7D0C4]">{c.role || "—"}</td>
                    <td className="px-2 py-1.5">
                      {isEditing ? (
                        <input
                          type="email"
                          className={editInputClass}
                          placeholder="Email"
                          value={editEmail}
                          disabled={savingEdit}
                          autoFocus
                          onChange={(e) => setEditEmail(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(c);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      ) : isApollo ? (
                        <ContactEmailCell
                          contactId={c.contact_id}
                          email={c.email}
                          apolloRevealStatus={c.apollo_reveal_status}
                          hideDelete
                          onRevealed={(updated) => {
                            patchContact(c.contact_id, {
                              email: (updated.email as string) ?? c.email,
                              phone: (updated.phone as string) ?? c.phone,
                              linkedin_url: (updated.linkedin_url as string) ?? c.linkedin_url,
                              apollo_reveal_status: "revealed",
                              first_name: (updated.first_name as string) ?? c.first_name,
                              last_name: (updated.last_name as string) ?? c.last_name,
                              role: (updated.role as string) ?? c.role,
                            });
                          }}
                          onDeleted={() => {
                            setContacts((prev) => {
                              const next = prev.filter((x) => x.contact_id !== c.contact_id);
                              onContactsChange?.(next.length);
                              return next;
                            });
                            onContactsMutated?.();
                          }}
                        />
                      ) : c.email ? (
                        <EmailWithCopy email={c.email} />
                      ) : (
                        <span className="text-[#8E877A]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {isEditing ? (
                        <input
                          type="tel"
                          className={editInputClass}
                          placeholder="Phone"
                          value={editPhone}
                          disabled={savingEdit}
                          onChange={(e) => setEditPhone(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(c);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      ) : (
                        <ContactPhoneCell
                          contactId={c.contact_id}
                          phone={c.phone}
                          apolloPersonId={c.apollo_person_id}
                          apolloPhoneRevealStatus={c.apollo_phone_reveal_status}
                          email={c.email}
                          linkedinUrl={c.linkedin_url}
                          firstName={c.first_name}
                          lastName={c.last_name}
                          compact
                          onRevealed={(updated) => {
                            const status = updated.apollo_phone_reveal_status;
                            patchContact(c.contact_id, {
                              phone: (updated.phone as string) ?? c.phone,
                              apollo_phone_reveal_status:
                                status === "pending" || status === "revealed" ? status : "pending",
                              apollo_person_id:
                                (updated.apollo_person_id as string) ?? c.apollo_person_id,
                            });
                          }}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {isEditing ? (
                        <input
                          type="text"
                          className={editInputClass}
                          placeholder="Move to company"
                          title="Change company to move this contact off this list"
                          value={editCompany}
                          disabled={savingEdit}
                          onChange={(e) => setEditCompany(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(c);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      ) : (
                        <ContactLinkedinCell
                          contactId={c.contact_id}
                          linkedinUrl={c.linkedin_url}
                          email={c.email}
                          firstName={c.first_name}
                          lastName={c.last_name}
                          apolloPersonId={c.apollo_person_id}
                          onRevealed={(updated) => {
                            patchContact(c.contact_id, {
                              linkedin_url: (updated.linkedin_url as string) ?? c.linkedin_url,
                              apollo_person_id:
                                (updated.apollo_person_id as string) ?? c.apollo_person_id,
                              apollo_reveal_status: "revealed",
                              email: (updated.email as string) ?? c.email,
                            });
                          }}
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="inline-flex items-center justify-end gap-0.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              title="Save"
                              disabled={savingEdit}
                              className="inline-flex rounded p-1 text-[#8E877A] hover:bg-[#1B2F21] hover:text-[#DBEEE0] disabled:opacity-50"
                              onClick={() => void saveEdit(c)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Cancel"
                              disabled={savingEdit}
                              className="inline-flex rounded p-1 text-[#8E877A] hover:bg-white/10 hover:text-[#ECE7DF] disabled:opacity-50"
                              onClick={cancelEdit}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            title="Edit email & phone"
                            disabled={deletingId === c.contact_id || savingEdit}
                            className="inline-flex rounded p-1 text-[#8E877A] hover:bg-white/10 hover:text-[#ECE7DF] disabled:opacity-50"
                            onClick={() => startEdit(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Delete contact"
                          disabled={deletingId === c.contact_id || isEditing}
                          className="inline-flex rounded p-1 text-[#8E877A] hover:bg-[#6B2E2E]/40 hover:text-[#F1A2A2] disabled:opacity-50"
                          onClick={() => void deleteContact(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
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
