"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  countDueByBucket,
  dueBucketForCard,
  getCardSignals,
  listDueCards,
  type PipelineCadenceCard,
} from "@/lib/crm/pipeline-cadence-ui";
import { PipelineCadenceBadge } from "@/components/crm/PipelineCadenceBadge";
import { Mail, Phone, Linkedin, X } from "lucide-react";

export function PipelineDuePill({
  cards,
  onClick,
}: {
  cards: PipelineCadenceCard[];
  onClick: () => void;
}) {
  const due = listDueCards(cards);
  if (due.length === 0) return null;

  const buckets = countDueByBucket(cards);
  const parts: string[] = [];
  if (buckets.email) parts.push(`${buckets.email} email`);
  if (buckets.call) parts.push(`${buckets.call} call`);
  if (buckets.linkedin) parts.push(`${buckets.linkedin} LI`);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 border-[#2E7040]/50 bg-[#1A2A20] text-xs text-[#A7E0B6] hover:bg-[#234530]"
      title={parts.length ? parts.join(" · ") : undefined}
      onClick={onClick}
    >
      {due.length} due
    </Button>
  );
}

export function PipelineDueDrawer({
  open,
  cards,
  onClose,
  onOpenCard,
}: {
  open: boolean;
  cards: PipelineCadenceCard[];
  onClose: () => void;
  onOpenCard: (id: string) => void;
}) {
  if (!open) return null;

  const due = listDueCards(cards);
  const emails = due.filter((c) => dueBucketForCard(c) === "email");
  const calls = due.filter((c) => dueBucketForCard(c) === "call");
  const linkedin = due.filter((c) => dueBucketForCard(c) === "linkedin");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" role="presentation" onClick={onClose} />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-white/10 bg-[#141916] shadow-xl"
        aria-label="Due outreach inbox"
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[#F4F1EB]">Due this week</h2>
            <p className="mt-0.5 text-xs text-[#8E877A]">
              Best window: Tue–Thu morning (recipient local). {due.length} actionable.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close due inbox"
            className="rounded p-1 text-[#B9B2A6] hover:bg-white/10 hover:text-[#F4F1EB]"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {due.length === 0 ? (
            <p className="text-sm text-[#8E877A]">Nothing due right now.</p>
          ) : (
            <div className="space-y-4">
              <DueGroup icon={<Mail className="h-3.5 w-3.5" />} label="Emails" items={emails} onOpenCard={onOpenCard} />
              <DueGroup icon={<Phone className="h-3.5 w-3.5" />} label="Calls" items={calls} onOpenCard={onOpenCard} />
              <DueGroup
                icon={<Linkedin className="h-3.5 w-3.5" />}
                label="LinkedIn"
                items={linkedin}
                onOpenCard={onOpenCard}
              />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function DueGroup({
  icon,
  label,
  items,
  onOpenCard,
}: {
  icon: ReactNode;
  label: string;
  items: PipelineCadenceCard[];
  onOpenCard: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#B9B2A6]">
        {icon}
        {label}
        <span className="text-[#8E877A]">({items.length})</span>
      </div>
      <ul className="space-y-1">
        {items.map((card) => {
          const signals = getCardSignals(card).slice(0, 1);
          return (
            <li key={card.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-[#171D1A] px-2 py-1.5 text-left hover:bg-[#1D2520]"
                onClick={() => onOpenCard(card.id)}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-[#ECE7DF]">{card.company_name}</span>
                <PipelineCadenceBadge card={card} className="mt-0 shrink-0" />
                {signals.map((s) => (
                  <Badge
                    key={s.id}
                    variant="secondary"
                    className={cn(
                      "hidden shrink-0 border-white/10 bg-[#202723] px-1 py-0 text-[9px] text-[#CFC8BC] sm:inline-flex"
                    )}
                  >
                    {s.label}
                  </Badge>
                ))}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
