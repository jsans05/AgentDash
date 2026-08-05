"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Linkedin, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompanyContactsTable } from "@/components/crm/CompanyContactsTable";
import {
  SequenceContactOfRecordPanel,
  type SequenceContactLifecyclePatch,
} from "@/components/crm/SequenceContactSelectors";
import {
  normalizePipelineContacts,
  type PipelineContactSlot,
} from "@/lib/crm/pipeline-contacts";
import { STAGE_LABEL, type PipelineStage } from "@/lib/crm/pipeline-stages";

export type SequenceCompanyDetailsRow = {
  id: string;
  company_id: string;
  company_name: string;
  product_category: string | null;
  pipeline_stage: string;
  website_url?: string | null;
  company_website?: string | null;
  hq_phone?: string | null;
  instagram_handle?: string | null;
  support_email_v2?: string | null;
  pipeline_contacts?: unknown;
  contact_of_record_id?: string | null;
  sequence_contact_id?: string | null;
  potential_athletes: Array<{ athlete_id: string; name?: string; sport?: string | null }>;
};

export type SequenceCompanyInfoPatch = {
  hq_phone?: string | null;
  instagram_handle?: string | null;
  support_email_v2?: string | null;
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as PipelineStage] ?? stage;
}

function websiteHref(raw: string | null | undefined): string | null {
  const u = (raw ?? "").trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

function linkedinHref(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

function filledPipelineSlots(raw: unknown): PipelineContactSlot[] {
  return normalizePipelineContacts(raw).filter(
    (c) => c.name || c.role || c.email || c.linkedin
  );
}

/** Inline company + contacts details shown beneath a sequence board row. */
export function SequenceCompanyDetails({
  row,
  onContactsSaved,
  onLifecycle,
  onCompanyInfoSaved,
}: {
  row: SequenceCompanyDetailsRow;
  onContactsSaved?: (patch: {
    contact_of_record_id?: string | null;
    sequence_contact_id?: string | null;
  }) => void;
  onLifecycle?: (patch: SequenceContactLifecyclePatch) => void;
  onCompanyInfoSaved?: (patch: SequenceCompanyInfoPatch) => void;
}) {
  const website = websiteHref(row.company_website ?? row.website_url);
  const pipelineSlots = filledPipelineSlots(row.pipeline_contacts);
  const athletes = row.potential_athletes
    .map((a) => a.name?.trim() || "Athlete")
    .join(", ");
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState(0);
  const [pullingInfo, setPullingInfo] = useState(false);
  const [pullInfoMsg, setPullInfoMsg] = useState<string | null>(null);
  const [pullInfoError, setPullInfoError] = useState<string | null>(null);

  const dropCompany = async () => {
    const empty = contactCount === 0;
    if (
      !window.confirm(
        empty
          ? `Drop ${row.company_name} from your pipeline? It has no contacts.`
          : `Drop ${row.company_name} from your pipeline? Contacts stay in CRM; only the pipeline card is removed.`
      )
    ) {
      return;
    }
    setDropping(true);
    setDropError(null);
    try {
      const res = await fetch("/api/crm/sequence", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "drop_company", card_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to drop company");
      onLifecycle?.({
        dropped_company: true,
        sequence_contact_id: null,
        contact_of_record_id: null,
        sequence_started_at: null,
      });
    } catch (e) {
      setDropError(e instanceof Error ? e.message : "Failed to drop company");
    } finally {
      setDropping(false);
    }
  };

  const pullCompanyInfo = async () => {
    setPullingInfo(true);
    setPullInfoError(null);
    setPullInfoMsg(null);
    try {
      const res = await fetch(`/api/crm/pipeline/${encodeURIComponent(row.id)}/pull-company-info`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to pull company info");

      const patch: SequenceCompanyInfoPatch = {
        hq_phone: json.hq_phone != null ? String(json.hq_phone) : row.hq_phone ?? null,
        instagram_handle:
          json.instagram_handle != null ? String(json.instagram_handle) : row.instagram_handle ?? null,
        support_email_v2:
          json.support_email_v2 != null ? String(json.support_email_v2) : row.support_email_v2 ?? null,
      };
      onCompanyInfoSaved?.(patch);

      const parts: string[] = [];
      if (json.updated?.hq_phone) parts.push("HQ phone");
      if (json.updated?.instagram_handle) parts.push("Instagram");
      if (json.updated?.support_email_v2) parts.push("support email");
      if (parts.length > 0) {
        setPullInfoMsg(`Updated: ${parts.join(", ")}`);
      } else if (json.any_found) {
        setPullInfoMsg("Already filled — nothing new to write");
      } else {
        setPullInfoMsg("Nothing found from Apollo / website");
      }
      if (Array.isArray(json.errors) && json.errors.length > 0) {
        setPullInfoError(json.errors.join(" · "));
      }
    } catch (e) {
      setPullInfoError(e instanceof Error ? e.message : "Failed to pull company info");
    } finally {
      setPullingInfo(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-white/10 bg-[#0C100E] px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#8E877A]">
          <span>{stageLabel(row.pipeline_stage)}</span>
          {row.product_category ? (
            <>
              <span aria-hidden>·</span>
              <span>{row.product_category}</span>
            </>
          ) : null}
          {athletes ? (
            <>
              <span aria-hidden>·</span>
              <span>{athletes}</span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/crm?pipeline_id=${encodeURIComponent(row.id)}`}
            className="text-xs text-[#CEE4D4] hover:underline"
          >
            Open full pipeline card
          </Link>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-[#8A4848]/40 text-[11px] text-[#F1A2A2] hover:bg-[#6B2E2E]/25"
            disabled={dropping}
            onClick={() => void dropCompany()}
          >
            {dropping
              ? "Dropping…"
              : contactCount === 0
                ? "Drop empty company"
                : "Drop company"}
          </Button>
        </div>
      </div>

      {dropError ? <p className="text-xs text-[#F1A2A2]">{dropError}</p> : null}
      {contactCount === 0 ? (
        <p className="text-xs text-amber-400/90">
          No contacts — add one on the left, find via Apollo, or drop this company.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,16rem)_1fr]">
        {row.company_id ? (
          <SequenceContactOfRecordPanel
            companyId={row.company_id}
            companyName={row.company_name}
            cardId={row.id}
            contactOfRecordId={row.contact_of_record_id ?? null}
            sequenceContactId={row.sequence_contact_id ?? null}
            onSaved={(patch) => onContactsSaved?.(patch)}
            onLifecycle={onLifecycle}
            onContactsChanged={(n) => {
              setContactCount(n);
              setTableKey((k) => k + 1);
            }}
          />
        ) : (
          <p className="text-xs text-[#8E877A]">No company record linked.</p>
        )}

        <section className="min-w-0 space-y-4">
          {row.company_id ? (
            <CompanyContactsTable
              key={`${row.company_id}:${tableKey}`}
              companyId={row.company_id}
              companyName={row.company_name}
              cardId={row.id}
              onLifecycle={onLifecycle}
              onContactsChange={setContactCount}
            />
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">
                Company info
              </h3>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-[11px]"
                disabled={pullingInfo || !website}
                title={
                  website
                    ? "Pull HQ phone from Apollo; Instagram & support email from the website"
                    : "Add a website first"
                }
                onClick={() => void pullCompanyInfo()}
              >
                {pullingInfo ? "Pulling…" : "Pull HQ / IG / support"}
              </Button>
            </div>
            {pullInfoError ? <p className="text-xs text-[#F1A2A2]">{pullInfoError}</p> : null}
            {pullInfoMsg ? <p className="text-xs text-[#B9B2A6]">{pullInfoMsg}</p> : null}
            <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
              <InfoRow label="Website">
                {website ? (
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-[#CEE4D4] hover:underline"
                  >
                    {row.company_website ?? row.website_url}
                  </a>
                ) : (
                  <span className="text-[#8E877A]">—</span>
                )}
              </InfoRow>
              <InfoRow label="HQ phone">
                {row.hq_phone?.trim() ? (
                  <a href={`tel:${row.hq_phone.trim()}`} className="text-[#CEE4D4] hover:underline">
                    {row.hq_phone}
                  </a>
                ) : (
                  <span className="text-[#8E877A]">—</span>
                )}
              </InfoRow>
              <InfoRow label="Instagram">
                {row.instagram_handle?.trim() ? (
                  <span className="text-[#ECE7DF]">{row.instagram_handle}</span>
                ) : (
                  <span className="text-[#8E877A]">—</span>
                )}
              </InfoRow>
              <InfoRow label="Support email">
                {row.support_email_v2?.trim() ? (
                  <a
                    href={`mailto:${encodeURIComponent(row.support_email_v2.trim())}`}
                    className="inline-flex items-center gap-1 text-[#CEE4D4] hover:underline"
                  >
                    {row.support_email_v2}
                    <Mail className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="text-[#8E877A]">—</span>
                )}
              </InfoRow>
            </dl>
          </div>

          {pipelineSlots.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#D7D0C4]">
                Pipeline slots
              </h3>
              <ul className="space-y-2">
                {pipelineSlots.map((c, i) => (
                  <li
                    key={`${c.name}-${c.email}-${i}`}
                    className="rounded-md border border-white/10 bg-[#151A17] px-3 py-2 text-sm"
                  >
                    <div className="font-medium text-[#F4F1EB]">{c.name || "Contact"}</div>
                    {c.role ? <div className="text-xs text-[#8E877A]">{c.role}</div> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                      {c.email ? (
                        <a
                          href={`mailto:${encodeURIComponent(c.email)}`}
                          className="inline-flex items-center gap-1 text-[#CEE4D4] hover:underline"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {c.email}
                        </a>
                      ) : null}
                      {c.linkedin ? (
                        <a
                          href={linkedinHref(c.linkedin)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#0A66C2] hover:opacity-80"
                        >
                          <Linkedin className="h-3.5 w-3.5" />
                          LinkedIn
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
      <dt className="text-xs text-[#8E877A]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
