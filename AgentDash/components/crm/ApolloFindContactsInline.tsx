"use client";

import { useState } from "react";
import { ApolloOrgPickerDialog } from "@/components/crm/ApolloOrgPickerDialog";
import { TargetListActionDialog } from "@/components/crm/TargetListActionDialog";
import { contactSearchOverridesToRequestBody } from "@/lib/apollo/contact-search-api-body";
import {
  formatApolloAllVerifiedSearchSummary,
  formatApolloPartnershipSearchSummary,
  formatApolloRefineSearchSummary,
  type ApolloContactSearchMode,
  type ApolloContactSearchOverrides,
} from "@/lib/apollo/search-defaults";
import {
  isTargetListDialogDismissed,
  TARGET_LIST_FIND_CONTACTS_DISMISS_KEY,
} from "@/lib/crm/target-list-prefs";

export type { ApolloContactSearchOverrides };

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
  requested_search_mode?: ApolloContactSearchMode;
  partnership_fallback_used?: boolean;
  no_matches?: boolean;
  hq_phone?: string | null;
  error?: string;
  organization?: {
    apollo_organization_name?: string | null;
    match_confidence?: "high" | "medium" | "low";
    match_notes?: string;
    product_category?: string | null;
  };
};

type ApolloFindContactsInlineProps = {
  companyId: string;
  companyName?: string;
  consultingProfileId?: string;
  disabled?: boolean;
  searchOverrides?: ApolloContactSearchOverrides;
  onRefineSearchClick?: () => void;
  onContacts: (contacts: unknown[], meta?: { hq_phone?: string | null }) => void;
  onError?: (message: string) => void;
};

export function ApolloFindContactsInline({
  companyId,
  companyName,
  consultingProfileId,
  disabled,
  searchOverrides,
  onRefineSearchClick,
  onContacts,
  onError,
}: ApolloFindContactsInlineProps) {
  const [finding, setFinding] = useState(false);
  const [partnershipNoMatch, setPartnershipNoMatch] = useState(false);
  const [allVerifiedNoMatch, setAllVerifiedNoMatch] = useState(false);
  const [partnershipFallbackUsed, setPartnershipFallbackUsed] = useState(false);
  const [activeSearchMode, setActiveSearchMode] = useState<ApolloContactSearchMode>("partnership");
  const [confirmMode, setConfirmMode] = useState<ApolloContactSearchMode | null>(null);
  const [page, setPage] = useState(1);
  const [lastFound, setLastFound] = useState(0);
  const [matchNote, setMatchNote] = useState<string | null>(null);
  const [matchConfidence, setMatchConfidence] = useState<"high" | "medium" | "low" | null>(
    null
  );
  const [orgPickerOpen, setOrgPickerOpen] = useState(false);

  const refineSummary = formatApolloRefineSearchSummary(searchOverrides);

  async function runSearch(searchMode: ApolloContactSearchMode, pageNum = 1) {
    setFinding(true);
    if (searchMode === "partnership") {
      setPartnershipNoMatch(false);
      setAllVerifiedNoMatch(false);
      setPartnershipFallbackUsed(false);
    } else {
      setAllVerifiedNoMatch(false);
      setPartnershipFallbackUsed(false);
    }
    try {
      const body: Record<string, unknown> = {
        search_mode: searchMode,
        page: pageNum,
        ...contactSearchOverridesToRequestBody(searchOverrides),
      };
      if (consultingProfileId) {
        body.consulting_profile_id = consultingProfileId;
      }
      const res = await fetch(`/api/apollo/companies/${companyId}/find-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as FindContactsResult;
      if (!res.ok) {
        throw new Error(data?.error || `Find contacts failed (${res.status})`);
      }
      onContacts(data.contacts ?? [], { hq_phone: data.hq_phone ?? null });
      const found = data.found ?? 0;
      const resolvedMode = data.search_mode ?? searchMode;
      setPage(pageNum);
      setLastFound(found);
      setActiveSearchMode(resolvedMode);
      setPartnershipFallbackUsed(Boolean(data.partnership_fallback_used));
      const org = data.organization;
      setMatchConfidence(org?.match_confidence ?? null);
      if (org?.match_notes) {
        setMatchNote(org.match_notes);
      } else if (org?.apollo_organization_name && org.apollo_organization_name !== companyName) {
        setMatchNote(`Apollo org: ${org.apollo_organization_name}`);
      } else {
        setMatchNote(null);
      }
      if (found === 0) {
        if (data.partnership_fallback_used || searchMode === "all_verified") {
          setAllVerifiedNoMatch(true);
          setPartnershipNoMatch(false);
        } else {
          setPartnershipNoMatch(true);
        }
      } else {
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
              {refineSummary ? <p className="text-[#E8D9A8]">Filters: {refineSummary}</p> : null}
              <p className="text-[#AEA79A]">
                Apollo search does not use credits. Revealing an email later uses Apollo credits.
              </p>
            </>
          ) : (
            <>
              <p>{formatApolloPartnershipSearchSummary()}</p>
              {refineSummary ? <p className="text-[#E8D9A8]">Also applying: {refineSummary}</p> : null}
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
        {onRefineSearchClick ? (
          <button
            type="button"
            className="rounded border border-[#3A4A5E]/60 bg-[#1A2028] px-1.5 py-0.5 text-[10px] font-medium text-[#B8C8DC] hover:bg-[#222A35] disabled:opacity-50"
            disabled={disabled || finding}
            title="Adjust job titles, country, seniority, and other Apollo filters"
            onClick={onRefineSearchClick}
          >
            Refine search
          </button>
        ) : null}
        {partnershipNoMatch && !partnershipFallbackUsed && !finding ? (
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
            onClick={() => void runSearch(activeSearchMode, page + 1)}
          >
            Load more
          </button>
        ) : null}
      </div>
      {refineSummary && !finding ? (
        <p className="text-[10px] text-[#9BB8D4]" title="Active Apollo search filters">
          Filters: {refineSummary}
        </p>
      ) : null}
      {finding ? (
        <p className="flex items-center gap-1.5 text-[10px] text-[#B9B2A6]">
          <InlineSpinner />
          Searching Apollo for {label}…
        </p>
      ) : null}
      {partnershipFallbackUsed && lastFound > 0 && !finding ? (
        <p className="text-[10px] text-[#D4C48A]">
          No department matches for {label}; expanded to any verified email.
        </p>
      ) : null}
      {partnershipNoMatch && !allVerifiedNoMatch ? (
        <p className="text-[10px] text-[#D4C48A]">
          No brand design / business development / partnerships contacts with verified email for{" "}
          {label}. Try{" "}
          <span className="text-[#E8D9A8]">Any verified email</span> to search all titles, or{" "}
          {onRefineSearchClick ? (
            <button
              type="button"
              className="text-[#B8C8DC] underline decoration-[#3A4A5E]/50 hover:text-[#DBEEE0]"
              onClick={onRefineSearchClick}
            >
              refine search
            </button>
          ) : (
            "refine search"
          )}
          .
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
          setPartnershipFallbackUsed(false);
          setLastFound(0);
          setActiveSearchMode("partnership");
        }}
      />
    </div>
  );
}
