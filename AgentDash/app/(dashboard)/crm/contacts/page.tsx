import Link from "next/link";
import { Suspense } from "react";
import { ContactsDirectory } from "@/components/crm/ContactsDirectory";

export default function CrmContactsPage() {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-[#0F1311]">
      <div className="shrink-0 border-b border-white/10 bg-[#141916] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#F4F1EB]">Contacts</h1>
            <p className="text-sm text-[#B9B2A6]">
              Search and filter your contact database by company, category, role, email, phone, LinkedIn, and status.
              Select contacts to export a list to Excel or delete in bulk.
            </p>
          </div>
          <Link
            href="/crm/contacts/new"
            className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add contact
          </Link>
        </div>
      </div>
      <Suspense fallback={<p className="p-4 text-sm text-[#B9B2A6]">Loading contacts…</p>}>
        <ContactsDirectory />
      </Suspense>
    </div>
  );
}
