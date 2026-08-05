"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatUiContext } from "./chat-routing";

export const COMPOSER_ICON_BUTTON_CLASS =
  "h-7 w-7 shrink-0 rounded-full bg-white/[0.06] p-0 text-[#AFA89C] hover:bg-white/10 hover:text-[#F4F1EB]";

export const COMPOSER_ICON_CLASS = "h-3.5 w-3.5";

const CONTEXT_BADGE_CLASS =
  "inline-flex max-w-[min(100%,280px)] shrink-0 items-center rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-[#D1CABF]";

const EMAIL_CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium bg-[#1A2332] text-[#C5D0E0] border-[#4A5F7A]/60 font-serif uppercase tracking-wide";

type Props = {
  uiContext?: ChatUiContext;
  contextCompanyName?: string;
  contextAthleteName?: string;
  athleteId?: string;
  /** CRM embedded sidebar without pipeline context — read-only EMAIL chip. */
  readOnlyEmail?: boolean;
};

export function ChatFlowModeSelector({
  uiContext,
  contextCompanyName,
  contextAthleteName,
  athleteId,
  readOnlyEmail = false,
}: Props) {
  const company = contextCompanyName?.trim();
  if (uiContext === "crm_pipeline" && company) {
    return (
      <span className={CONTEXT_BADGE_CLASS} title={`Pipeline drafting for ${company}`}>
        Drafting for {company} pipeline card
      </span>
    );
  }

  const athleteName = contextAthleteName?.trim();
  if (uiContext === "target_list" && athleteId) {
    return (
      <span
        className={CONTEXT_BADGE_CLASS}
        title={athleteName ? `${athleteName} target list` : "Athlete target list"}
      >
        {athleteName ? `Working on ${athleteName}'s target list` : "Working on athlete target list"}
      </span>
    );
  }

  if (uiContext === "consulting_target_list") {
    return (
      <span
        className={CONTEXT_BADGE_CLASS}
        title={athleteName ? `${athleteName} consulting target list` : "Consulting target list"}
      >
        {athleteName
          ? `Working on ${athleteName} consulting target list`
          : "Working on consulting target list"}
      </span>
    );
  }

  if (uiContext === "master_target_list") {
    return (
      <span className={CONTEXT_BADGE_CLASS} title="Master target list">
        Working on master target list
      </span>
    );
  }

  if (readOnlyEmail) {
    return (
      <span className={cn(EMAIL_CHIP_CLASS)} title="Draft outreach emails">
        <Users className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
        <span>EMAIL</span>
      </span>
    );
  }

  return null;
}