"use client";

import { useState } from "react";
import { ApolloOrgPickerDialog } from "@/components/crm/ApolloOrgPickerDialog";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import {
  formatApolloAllVerifiedSearchSummary,
  formatApolloPartnershipSearchSummary,
  type ApolloContactSearchMode,
} from "@/lib/apollo/search-defaults";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_FIND_CONTACTS_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

function InlineSpinner() {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#DBEEE0]/25 border-t-[#DBEEE0]"
      aria-hidden
    />
  );
}

type FindContactsResult = {
  contacts?: unknown[];
  found?: number;
  filtered_out?: number;
  search_mode?: ApolloContactSearchMode;
  no_matches?: boolean;
  error?: string;
  organization?: {
    apollo_organization_name?: string | null;
    match_confidence?: "high" | "medium" | "low";
    match_notes?: string;
    product_category?: string | null;
  };
};

export type ApolloContactSearchOverrides = {
  organization_locations?: string[];
  revenue_range?: { min?: number; max?: number };
  page?: number;
};

type ApolloFindContactsInlineProps = {
  companyId: string;
  companyName?: string;
  disabled?: boolean;
  searchOverrides?: ApolloContactSearchOverrides;
  onContacts: (contacts: unknown[]) => void;
  onError?: (message: string) => void;
};

export function ApolloFindContactsInline({
  companyId,
  companyName,
  disabled,
  searchOverrides,
  onContacts,
  onError,
}: ApolloFindContactsInlineProps) {
  const [finding, setFinding] = useState(false);
  const [partnershipNoMatch, setPartnershipNoMatch] = useState(false);
  const [allVerifiedNoMatch, setAllVerifiedNoMatch] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ApolloContactSearchMode | null>(null);
  const [page, setPage] = useState(1);
  const [lastFound, setLastFound] = useState(0);
  const [matchNote, setMatchNote] = useState<string | null>(null);
  const [matchConfidence, setMatchConfidence] = useState<"high" | "medium" | "low" | null>(
    null
  );
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);

  async function runSearch(searchMode: ApolloContactSearchMode, pageNum = 1) {
    setFinding(true);
    if (searchMode === "partnership") {
      setPartnershipNoMatch(false);
      setAllVerifiedNoMatch(false);
    } else {
      setAllVerifiedNoMatch(false);
    }
    try {
      const body: Record<string, unknown> = {
        search_mode: searchMode,
        page: pageNum,
      };
      if (searchOverrides?.organization_locations?.length) {
        body.organization_locations = searchOverrides.organization_locations;
      }
      if (searchOverrides?.revenue_range) {
        body.revenue_range = searchOverrides.revenue_range;
      }
      const res = await fetch(`/api/apollo/companies/${companyId}/find-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as FindContactsResult;
      if (!res.ok) {
        throw new Error(data?.error || "Find contacts failed");
      }
      onContacts(data.contacts ?? []);
      const found = data.found ?? 0;
      setPage(pageNum);
      setLastFound(found);
      const org = data.organization;
      setMatchConfidence(org?.match_confidence ?? null);
      if (org?.match_notes) {
        setMatchNote(org.match_notes);
      } else if (org?.apollo_organization_name && org.apollo_organization_name !== companyName) {
        setMatchNote(`Apollo org: ${org.apollo_organization_name}`);
      } else {
        setMatchNote(null);
      }
      if (searchMode === "partnership" && found === 0) {
        setPartnershipNoMatch(true);
      } else if (searchMode === "all_verified" && found === 0) {
        setAllVerifiedNoMatch(true);
      } else if (found > 0) {
        setPartnershipNoMatch(false);
        setAllVerifiedNoMatch(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Find contacts failed";
      onError?.(msg);
    } finally {
      setFinding(false);
    }
  }

  function requestSearch(searchMode: ApolloContactSearchMode) {
    if (disabled || finding) return;
    if (isTargetListDialogDismissed(TARGET_LIST_FIND_CONTACTS_DISMISS_KEY)) {
      void runSearch(searchMode);
      return;
    }
    setConfirmMode(searchMode);
  }

  const label = companyName ? `${companyName}` : "this company";
  const confirmIsAllVerified = confirmMode === "all_verified";

  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <TargetListActionDialog
        open={confirmMode != null}
        title={confirmIsAllVerified ? "Search all verified contacts?" : "Find contacts via Apollo?"}
        description={
          confirmIsAllVerified ? (
            <>
              <p>{formatApolloAllVerifiedSearchSummary()}</p>
              <p className="text-[#AEA79A]">
                Apollo search does not use credits. Revealing an email later uses Apollo credits.
              </p>
            </>
          ) : (
            <>
              <p>{formatApolloPartnershipSearchSummary()}</p>
              <p className="text-[#AEA79A]">
                Apollo search does not use credits. Revealing an email later uses Apollo credits.
              </p>
            </>
          )
        }
        confirmLabel={confirmIsAllVerified ? "Search" : "Find contacts"}
        dismissStorageKey={TARGET_LIST_FIND_CONTACTS_DISMISS_KEY}
        onCancel={() => setConfirmMode(null)}
        onConfirm={() => {
          const mode = confirmMode;
          setConfirmMode(null);
          if (mode) void runSearch(mode);
        }}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {finding ? <InlineSpinner /> : null}
        <button
          type="button"
          className="rounded border border-[#2E7040]/50 bg-[#1B2F21] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || finding}
          title={formatApolloPartnershipSearchSummary()}
          onClick={() => requestSearch("partnership")}
        >
          {finding ? "Searching…" : "Find contacts"}
        </button>
        {partnershipNoMatch && !finding ? (
          <button
            type="button"
            className="rounded border border-[#6B5A2E]/60 bg-[#2A2618] px-1.5 py-0.5 text-[10px] font-medium text-[#E8D9A8] hover:bg-[#35301F] disabled:opacity-50"
            disabled={disabled || finding}
            title={formatApolloAllVerifiedSearchSummary()}
            onClick={() => requestSearch("all_verified")}
          >
            Any verified email
          </button>
        ) : null}
        {lastFound > 0 && !finding ? (
          <button
            type="button"
            className="rounded border border-[#2E7040]/40 bg-[#173522] px-1.5 py-0.5 text-[10px] font-medium text-[#DBEEE0] hover:bg-[#1F4730] disabled:opacity-50"
            disabled={disabled || finding}
            title="Fetch next page of Apollo contacts"
            onClick={() => void runSearch("partnership", page + 1)}
          >
            Load more
          </button>
        ) : null}
      </div>
      {finding ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[#B9B2A6]">
          <InlineSpinner />
          Searching Apollo for {label}…
        </p>
      ) : null}
      {partnershipNoMatch && !allVerifiedNoMatch ? (
        <p className="text-[10px] text-[#D4C48A]">
          No partnership/marketing contacts with verified email for {label}. Try{" "}
          <span className="text-[#E8D9A8]">Any verified email</span> to search all titles.
        </p>
      ) : null}
      {allVerifiedNoMatch ? (
        <p className="text-[10px] text-[#D4A8A8]">
          No contacts with verified email at {label} in Apollo (any title).
        </p>
      ) : null}
      {matchNote && !finding ? (
        <p
          className="text-[10px] text-[#AEA79A]"
          title="Which Apollo company record was used for this search"
        >
          {matchNote}
          {matchConfidence !== "high" ? (
            <>
              {" "}
              <button
                type="button"
                className="text-[#9FD4A8] underline decoration-[#2E7040]/50 hover:text-[#DBEEE0]"
                onClick={() => setOrgPickerOpen(true)}
              >
                Wrong company?
              </button>
            </>
          ) : (
            <>
              {" "}
              <button
                type="button"
                className="text-[#8A8478] underline decoration-white/10 hover:text-[#AEA79A]"
                onClick={() => setOrgPickerOpen(true)}
              >
                Wrong company?
              </button>
            </>
          )}
        </p>
      ) : !finding ? (
        <button
          type="button"
          className="text-[10px] text-[#8A8478] underline decoration-white/10 hover:text-[#AEA79A]"
          onClick={() => setOrgPickerOpen(true)}
        >
          Wrong company?
        </button>
      ) : null}

      <ApolloOrgPickerDialog
        open={orgPickerOpen}
        companyId={companyId}
        companyName={companyName}
        onClose={() => setOrgPickerOpen(false)}
        onSelected={({ apollo_organization_name, match_notes, pending_contacts_cleared }) => {
          const cleared =
            pending_contacts_cleared > 0
              ? ` Cleared ${pending_contacts_cleared} pending contact(s).`
              : "";
          const base =
            match_notes ??
            `Using Apollo org "${apollo_organization_name}" (selected manually)`;
          setMatchNote(`${base}${cleared} Re-run Find contacts.`);
          setMatchConfidence("medium");
          onContacts([]);
          setPartnershipNoMatch(false);
          setAllVerifiedNoMatch(false);
          setLastFound(0);
        }}
      />
    </div>
  );
}
