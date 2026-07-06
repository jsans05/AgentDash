"use client";

import {
  findStaleDuplicateContactIds,
} from "@/lib/crm/target-list-duplicate-contacts";
import {
  isBulkRemovableTargetListContact,
  isUnrevealedDeletableTargetListContact,
  type TargetListContactShape,
} from "@/lib/crm/target-list-contacts";

type Props = {
  contacts: TargetListContactShape[];
  selectedContactIds: Set<string>;
  onSelectedContactIdsChange: (next: Set<string>) => void;
  onRequestBulkDelete: (contactIds: string[], mode: "unrevealed" | "selected" | "duplicates") => void;
  deleting: boolean;
  disabled?: boolean;
};

function deletableContactsForCompany(contacts: TargetListContactShape[]): TargetListContactShape[] {
  return contacts.filter((c) => isBulkRemovableTargetListContact(c, contacts));
}

function unrevealedDeletableContacts(contacts: TargetListContactShape[]): TargetListContactShape[] {
  return contacts.filter(isUnrevealedDeletableTargetListContact);
}

function staleDuplicateContacts(contacts: TargetListContactShape[]): TargetListContactShape[] {
  const staleIds = new Set(findStaleDuplicateContactIds(contacts));
  return contacts.filter((c) => staleIds.has(c.contact_id));
}

function selectedForCompany(
  contacts: TargetListContactShape[],
  selectedContactIds: Set<string>
): TargetListContactShape[] {
  const ids = new Set(deletableContactsForCompany(contacts).map((c) => c.contact_id));
  return contacts.filter((c) => ids.has(c.contact_id) && selectedContactIds.has(c.contact_id));
}

export function TargetListCompanyContactActions({
  contacts,
  selectedContactIds,
  onSelectedContactIdsChange,
  onRequestBulkDelete,
  deleting,
  disabled,
}: Props) {
  const deletable = deletableContactsForCompany(contacts);
  const unrevealed = unrevealedDeletableContacts(contacts);
  const duplicates = staleDuplicateContacts(contacts);
  const selected = selectedForCompany(contacts, selectedContactIds);

  if (duplicates.length === 0 && unrevealed.length === 0 && selected.length === 0 && deletable.length === 0) {
    return null;
  }

  const btn =
    "block w-full rounded border px-1.5 py-0.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50";

  function selectAllDeletable() {
    const next = new Set(selectedContactIds);
    for (const c of deletable) next.add(c.contact_id);
    onSelectedContactIdsChange(next);
  }

  function clearSelectedForCompany() {
    const next = new Set(selectedContactIds);
    for (const c of deletable) next.delete(c.contact_id);
    onSelectedContactIdsChange(next);
  }

  return (
    <div className="space-y-1 border-t border-white/10 pt-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[#AEA79A]">Contacts</span>
      {duplicates.length > 0 ? (
        <button
          type="button"
          className={`${btn} border-[#8C3A3A]/50 bg-[#2A1818] text-[#F1A2A2] hover:bg-[#3A1E1E]`}
          disabled={disabled || deleting}
          onClick={(e) => {
            e.stopPropagation();
            onRequestBulkDelete(
              duplicates.map((c) => c.contact_id),
              "duplicates"
            );
          }}
        >
          {deleting ? "Removing…" : `Remove duplicates (${duplicates.length})`}
        </button>
      ) : null}
      {unrevealed.length > 0 ? (
        <button
          type="button"
          className={`${btn} border-[#8C3A3A]/50 bg-[#2A1818] text-[#F1A2A2] hover:bg-[#3A1E1E]`}
          disabled={disabled || deleting}
          onClick={(e) => {
            e.stopPropagation();
            onRequestBulkDelete(
              unrevealed.map((c) => c.contact_id),
              "unrevealed"
            );
          }}
        >
          {deleting ? "Removing…" : `Remove unrevealed (${unrevealed.length})`}
        </button>
      ) : null}
      {selected.length > 0 ? (
        <button
          type="button"
          className={`${btn} border-[#8C3A3A]/50 bg-[#2A1818] text-[#F1A2A2] hover:bg-[#3A1E1E]`}
          disabled={disabled || deleting}
          onClick={(e) => {
            e.stopPropagation();
            onRequestBulkDelete(
              selected.map((c) => c.contact_id),
              "selected"
            );
          }}
        >
          {deleting ? "Removing…" : `Remove selected (${selected.length})`}
        </button>
      ) : null}
      <div className="flex flex-wrap gap-2 text-[10px]">
        <button
          type="button"
          className="text-[#AEA79A] underline hover:text-[#D7D0C4] disabled:opacity-50"
          disabled={disabled || deleting}
          onClick={(e) => {
            e.stopPropagation();
            selectAllDeletable();
          }}
        >
          Select all
        </button>
        {selected.length > 0 ? (
          <button
            type="button"
            className="text-[#AEA79A] underline hover:text-[#D7D0C4] disabled:opacity-50"
            disabled={disabled || deleting}
            onClick={(e) => {
              e.stopPropagation();
              clearSelectedForCompany();
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
