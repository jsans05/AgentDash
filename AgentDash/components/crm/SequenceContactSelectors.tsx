"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatContactDisplayName } from "@/lib/crm/contact-display-name";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SequenceContactOption = {
  contact_id: string;
  first_name: string;
  last_name: string;
  role: string | null;
  email: string | null;
};

export type SequenceContactLifecyclePatch = {
  contact_of_record_id?: string | null;
  sequence_contact_id?: string | null;
  sequence_started_at?: string | null;
  pipeline_stage?: string | null;
  moved_to_ghost?: boolean;
  moved_to_bounced?: boolean;
  needs_next_contact?: boolean;
  bounced_contact_id?: string | null;
  deleted_contact_id?: string | null;
  dropped_company?: boolean;
  remaining_contacts?: number;
};

function optionLabel(c: SequenceContactOption): string {
  return formatContactDisplayName(c.first_name, c.last_name) || "Contact";
}

export function useCompanyContacts(companyId: string | null | undefined) {
  const [contacts, setContacts] = useState<SequenceContactOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) {
      setContacts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/companies/${encodeURIComponent(companyId)}/contacts`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load contacts");
      const rows = Array.isArray(data.contacts) ? data.contacts : [];
      setContacts(
        rows.map((c: Record<string, unknown>) => ({
          contact_id: String(c.contact_id),
          first_name: String(c.first_name ?? ""),
          last_name: String(c.last_name ?? ""),
          role: c.role != null ? String(c.role) : null,
          email: c.email != null ? String(c.email) : null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contacts, loading, error, reload: load, setContacts };
}

type Props = {
  companyId: string;
  companyName: string;
  cardId: string;
  contactOfRecordId: string | null;
  sequenceContactId: string | null;
  onSaved: (patch: {
    contact_of_record_id?: string | null;
    sequence_contact_id?: string | null;
  }) => void;
  onLifecycle?: (patch: SequenceContactLifecyclePatch) => void;
  onContactsChanged?: (count: number) => void;
};

/**
 * Left-rail contact-of-record picker for the sequence board expand panel.
 * Auto-assigns when only one contact exists. Includes add-contact + bounce.
 */
export function SequenceContactOfRecordPanel({
  companyId,
  companyName,
  cardId,
  contactOfRecordId,
  sequenceContactId,
  onSaved,
  onLifecycle,
  onContactsChanged,
}: Props) {
  const { contacts, loading, error, reload, setContacts } = useCompanyContacts(companyId);
  const [busy, setBusy] = useState<"save" | "bounce" | "add" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const autoAssignedRef = useRef<string | null>(null);

  useEffect(() => {
    onContactsChanged?.(contacts.length);
  }, [contacts.length, onContactsChanged]);

  const saveFields = useCallback(
    async (patch: {
      contact_of_record_id?: string | null;
      sequence_contact_id?: string | null;
    }) => {
      setBusy("save");
      setLocalError(null);
      try {
        const res = await fetch(`/api/crm/pipeline/${encodeURIComponent(cardId)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to save contact");
        const card = (json.card ?? json) as Record<string, unknown>;
        onSaved({
          contact_of_record_id:
            Object.prototype.hasOwnProperty.call(card, "contact_of_record_id")
              ? card.contact_of_record_id != null
                ? String(card.contact_of_record_id)
                : null
              : patch.contact_of_record_id,
          sequence_contact_id:
            Object.prototype.hasOwnProperty.call(card, "sequence_contact_id")
              ? card.sequence_contact_id != null
                ? String(card.sequence_contact_id)
                : null
              : patch.sequence_contact_id,
        });
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : "Failed to save");
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [cardId, onSaved]
  );

  // Default of-record (and talking-to) when there is exactly one contact.
  useEffect(() => {
    if (loading || busy) return;
    if (contacts.length !== 1) return;
    const only = contacts[0]!;
    if (contactOfRecordId === only.contact_id) return;
    if (autoAssignedRef.current === only.contact_id) return;
    autoAssignedRef.current = only.contact_id;
    void saveFields({
      contact_of_record_id: only.contact_id,
      sequence_contact_id: sequenceContactId || only.contact_id,
    }).catch(() => {
      autoAssignedRef.current = null;
    });
  }, [
    loading,
    busy,
    contacts,
    contactOfRecordId,
    sequenceContactId,
    saveFields,
  ]);

  const selectOfRecord = async (contactId: string) => {
    const patch: {
      contact_of_record_id: string;
      sequence_contact_id?: string;
    } = { contact_of_record_id: contactId };
    if (!sequenceContactId || sequenceContactId === contactOfRecordId) {
      patch.sequence_contact_id = contactId;
    }
    await saveFields(patch);
  };

  const selectTalkingTo = async (contactId: string) => {
    await saveFields({ sequence_contact_id: contactId });
  };

  const bounceContact = async (contactId: string) => {
    const label =
      contacts.find((c) => c.contact_id === contactId) != null
        ? optionLabel(contacts.find((c) => c.contact_id === contactId)!)
        : "this contact";
    if (
      !window.confirm(
        `Mark ${label} as bounced?\n\nTheir email will be quarantined. If no other contacts remain, this company moves to Ghost.`
      )
    ) {
      return;
    }
    setBusy("bounce");
    setLocalError(null);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bounce_contact",
          card_id: cardId,
          contact_id: contactId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to bounce contact");
      onLifecycle?.({
        contact_of_record_id:
          json.contact_of_record_id !== undefined ? json.contact_of_record_id : undefined,
        sequence_contact_id:
          json.sequence_contact_id !== undefined ? json.sequence_contact_id : undefined,
        sequence_started_at:
          json.sequence_started_at !== undefined ? json.sequence_started_at : null,
        pipeline_stage: json.pipeline_stage ?? null,
        moved_to_ghost: Boolean(json.moved_to_ghost),
        moved_to_bounced: Boolean(json.moved_to_bounced),
        needs_next_contact: Boolean(json.needs_next_contact),
        bounced_contact_id: json.bounced_contact_id ?? contactId,
        remaining_contacts: json.remaining_contacts,
      });
      await reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to bounce");
    } finally {
      setBusy(null);
    }
  };

  const addContact = async () => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setLocalError("First and last name are required");
      return;
    }
    setBusy("add");
    setLocalError(null);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          first_name: fn,
          last_name: ln,
          role: role.trim() || null,
          email: email.trim() || null,
          linkedin_url: linkedin.trim() || null,
          outreach_mode: "email",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to add contact");
      const createdId = String(json.contact?.contact_id ?? "").trim();
      if (!createdId) throw new Error("Contact created without id");

      const created: SequenceContactOption = {
        contact_id: createdId,
        first_name: fn,
        last_name: ln,
        role: role.trim() || null,
        email: email.trim() || null,
      };
      setContacts((prev) => {
        if (prev.some((c) => c.contact_id === createdId)) return prev;
        return [...prev, created];
      });

      await saveFields({
        contact_of_record_id: contactOfRecordId || createdId,
        sequence_contact_id: sequenceContactId || createdId,
      });

      setAdding(false);
      setFirstName("");
      setLastName("");
      setRole("");
      setEmail("");
      setLinkedin("");
      await reload();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to add contact");
    } finally {
      setBusy(null);
    }
  };

  const bounceTargetId = sequenceContactId || contactOfRecordId;
  const inputClass =
    "w-full rounded-md border border-white/15 bg-[#101513] px-2 py-1.5 text-xs text-[#ECE7DF] placeholder:text-[#5E574C]";

  return (
    <aside className="space-y-3 rounded-lg border border-white/10 bg-[#101513] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">
          Contact of record
        </h3>
        <button
          type="button"
          className="text-[10px] text-[#8E877A] hover:text-[#D7D0C4]"
          onClick={() => void reload()}
        >
          Refresh
        </button>
      </div>

      {error || localError ? (
        <p className="text-xs text-[#F1A2A2]">{localError || error}</p>
      ) : null}
      {loading ? <p className="text-xs text-[#8E877A]">Loading…</p> : null}

      {!loading && contacts.length === 0 && !adding ? (
        <p className="text-xs text-[#8E877A]">No contacts yet — add one below.</p>
      ) : null}

      <div className="space-y-1.5">
        {contacts.map((c) => {
          const isOfRecord = contactOfRecordId === c.contact_id;
          const isTalkingTo =
            (sequenceContactId || contactOfRecordId) === c.contact_id;
          return (
            <div key={c.contact_id} className="space-y-1">
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void selectOfRecord(c.contact_id)}
                className={cn(
                  "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                  isOfRecord
                    ? "border-[#2E7040]/70 bg-[#1D2D22] ring-1 ring-[#2E7040]/40"
                    : "border-white/10 bg-[#151A17] hover:border-white/25 hover:bg-[#1A211D]"
                )}
              >
                <div className="text-sm font-medium text-[#F4F1EB]">{optionLabel(c)}</div>
                {c.role ? <div className="text-[10px] text-[#8E877A]">{c.role}</div> : null}
                {c.email ? (
                  <div className="truncate text-[10px] text-[#B9B2A6]">{c.email}</div>
                ) : null}
                {isOfRecord ? (
                  <div className="mt-1 text-[10px] font-medium text-[#9FD4A8]">Of record</div>
                ) : null}
              </button>
              {!isTalkingTo ? (
                <button
                  type="button"
                  disabled={busy != null}
                  className="w-full text-left text-[10px] text-[#8E877A] hover:text-[#CEE4D4]"
                  onClick={() => void selectTalkingTo(c.contact_id)}
                >
                  Set as talking to
                </button>
              ) : (
                <div className="text-[10px] text-[#CEE4D4]">Talking to (sequence)</div>
              )}
            </div>
          );
        })}
      </div>

      {bounceTargetId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 w-full border-[#8A4848]/50 text-[11px] text-[#F1A2A2] hover:bg-[#6B2E2E]/30"
          disabled={busy != null}
          onClick={() => void bounceContact(bounceTargetId)}
        >
          {busy === "bounce" ? "Bouncing…" : "Bounce bad contact"}
        </Button>
      ) : null}

      {adding ? (
        <div className="space-y-2 rounded-md border border-white/10 bg-[#0C100E] p-2">
          <div className="text-[11px] font-medium text-[#D7D0C4]">Add contact</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              className={inputClass}
              placeholder="First name *"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Last name *"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <input
            className={inputClass}
            placeholder="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="LinkedIn URL"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 text-[11px]"
              disabled={busy != null}
              onClick={() => void addContact()}
            >
              {busy === "add" ? "Saving…" : "Save contact"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={busy != null}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 w-full text-[11px]"
          onClick={() => setAdding(true)}
        >
          + Add contact
        </Button>
      )}
    </aside>
  );
}

/** @deprecated Use SequenceContactOfRecordPanel */
export const SequenceContactSelectors = SequenceContactOfRecordPanel;

export function contactLabelFromOptions(
  contactId: string | null | undefined,
  contacts: SequenceContactOption[]
): string | null {
  if (!contactId) return null;
  const c = contacts.find((x) => x.contact_id === contactId);
  if (!c) return null;
  return formatContactDisplayName(c.first_name, c.last_name) || "Contact";
}
