"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { useAuth } from "@/app/providers";
import { ChatPanel, type ChatPanelHandle, type ChatProject, type Message, type ChatPanelSendOptions } from "@/components/chat/ChatPanel";
import { postAiChat, type PostAiChatResult } from "@/lib/ai/chat-fetch";
import type { ChatSseEvent } from "@/lib/ai/chat-sse";
import type { InteractionResponsePayload } from "@/lib/ai/user-question";
import { isEffectivelyUncategorizedCompanyCategory } from "@/lib/crm/company-category";
import {
  clampTargetListPanelWidth,
  readStoredTargetListPanelCollapsed,
  readStoredTargetListPanelWidth,
  TARGET_LIST_AI_PANEL_COLLAPSED_KEY,
  TARGET_LIST_AI_PANEL_MOBILE_BREAKPOINT_PX,
  TARGET_LIST_AI_PANEL_WIDTH_DEFAULT,
  TARGET_LIST_AI_PANEL_WIDTH_KEY,
  TARGET_LIST_CATEGORY_FILTER_ALL,
  TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED,
  TARGET_LIST_MUTATING_TOOLS,
} from "@/lib/crm/target-list-chat-constants";
import type { TargetListFocusedRow } from "@/lib/crm/target-list-session-context";
import { cn } from "@/lib/utils";

export type TargetListAiDockRow = {
  pipeline_id: string;
  company_id: string;
  company_name: string;
  category: string | null;
};

export type TargetListAiPanelProps = {
  athleteId: string;
  athleteName?: string;
  rows: TargetListAiDockRow[];
  activeCategoryFilter: string;
  selectedCompanyIds: Set<string>;
  focusedRow: TargetListFocusedRow | null;
  getSessionContext: () => string;
  onMutatingToolsUsed?: () => void;
  onChatComplete?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export type TargetListAiDockProps = TargetListAiPanelProps;

type QuickChip = { id: string; label: string; prompt: string };

function useIsMobilePanel(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${TARGET_LIST_AI_PANEL_MOBILE_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function buildQuickChips(props: TargetListAiPanelProps): QuickChip[] {
  const chips: QuickChip[] = [];
  const { rows, activeCategoryFilter, selectedCompanyIds, focusedRow, athleteName } = props;

  const uncategorizedCount = rows.filter((r) =>
    isEffectivelyUncategorizedCompanyCategory(r.category)
  ).length;

  const selectedRows = rows.filter((r) => selectedCompanyIds.has(r.company_id));
  const selectedNames = selectedRows.map((r) => r.company_name).filter(Boolean);

  let categoryLabel: string | null = null;
  let categoryCount = 0;
  if (
    activeCategoryFilter !== TARGET_LIST_CATEGORY_FILTER_ALL &&
    activeCategoryFilter !== TARGET_LIST_CATEGORY_FILTER_UNCATEGORIZED
  ) {
    categoryLabel = activeCategoryFilter;
    categoryCount = rows.filter(
      (r) => String(r.category ?? "").trim().toLowerCase() === activeCategoryFilter.toLowerCase()
    ).length;
  } else if (selectedRows.length > 0) {
    const cats = new Set(
      selectedRows.map((r) =>
        isEffectivelyUncategorizedCompanyCategory(r.category)
          ? "Uncategorized"
          : String(r.category ?? "").trim()
      )
    );
    if (cats.size === 1) {
      categoryLabel = [...cats][0] ?? null;
      categoryCount = selectedRows.length;
    }
  }

  if (categoryLabel && categoryCount > 0) {
    chips.push({
      id: "draft-category",
      label: `Draft emails — ${categoryLabel}`,
      prompt: `Draft outreach emails for all ${categoryCount} companies in ${categoryLabel} on ${athleteName ? `${athleteName}'s` : "this athlete's"} target list. Show each draft for approval, then save each to the target list with updateTargetListOutreach when I approve.`,
    });
  }

  if (focusedRow) {
    const contactPart = focusedRow.contactName ? ` (${focusedRow.contactName})` : "";
    chips.push({
      id: "improve-email",
      label: `Improve — ${focusedRow.companyName}`,
      prompt: `Improve the outreach email for ${focusedRow.companyName}${contactPart} on this target list (pipeline_id=${focusedRow.pipelineId}${focusedRow.contactId ? `, contact_id=${focusedRow.contactId}` : ""}). Show me a revision, then save when I approve using updateTargetListOutreach.`,
    });
  }

  if (uncategorizedCount > 0) {
    chips.push({
      id: "categorize",
      label: `Categorize (${uncategorizedCount})`,
      prompt: `Load uncategorized companies on this athlete's target list (getAthleteTargetList with uncategorized_only: true) and suggest categories. Apply with updateTargetListCompanyCategories after I confirm.`,
    });
  }

  if (selectedNames.length > 0) {
    chips.push({
      id: "remove-selected",
      label: `Remove selected (${selectedNames.length})`,
      prompt: `Remove these companies from ${athleteName ? `${athleteName}'s` : "this athlete's"} target list: ${selectedNames.join(", ")}. Use removeAthleteFromTargetListCards.`,
    });
  }

  return chips;
}

function TargetListAiPanelInner({
  athleteId,
  athleteName,
  rows,
  activeCategoryFilter,
  selectedCompanyIds,
  focusedRow,
  getSessionContext,
  onMutatingToolsUsed,
  onChatComplete,
  collapsed: collapsedProp,
  onCollapsedChange,
}: TargetListAiPanelProps) {
  const { profile } = useAuth();
  const role = (profile?.role ?? "agent") as "admin" | "sales" | "agent";
  const chatRef = useRef<ChatPanelHandle>(null);
  const toolsUsedRef = useRef<Set<string>>(new Set());
  const isMobile = useIsMobilePanel();

  const [collapsedInternal, setCollapsedInternal] = useState(false);
  const collapsed = collapsedProp ?? collapsedInternal;
  const setCollapsed = useCallback(
    (next: boolean) => {
      if (onCollapsedChange) onCollapsedChange(next);
      else setCollapsedInternal(next);
      try {
        localStorage.setItem(TARGET_LIST_AI_PANEL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [onCollapsedChange]
  );

  const [panelWidthPx, setPanelWidthPx] = useState(TARGET_LIST_AI_PANEL_WIDTH_DEFAULT);
  const [panelResizeActive, setPanelResizeActive] = useState(false);
  const panelWidthRef = useRef(panelWidthPx);
  panelWidthRef.current = panelWidthPx;

  useEffect(() => {
    setCollapsedInternal(readStoredTargetListPanelCollapsed());
    const stored = readStoredTargetListPanelWidth();
    if (stored != null) setPanelWidthPx(stored);
  }, []);

  useEffect(() => {
    const onResize = () => setPanelWidthPx((w) => clampTargetListPanelWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPanelResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;
    setPanelResizeActive(true);

    const onMove = (ev: PointerEvent) => {
      const next = clampTargetListPanelWidth(startWidth + (startX - ev.clientX));
      setPanelWidthPx(next);
    };
    const onUp = () => {
      setPanelResizeActive(false);
      try {
        localStorage.setItem(TARGET_LIST_AI_PANEL_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const onSend = useCallback(
    async (
      messages: Message[],
      project: ChatProject,
      conversationId: string,
      options?: ChatPanelSendOptions
    ): Promise<PostAiChatResult> => {
      toolsUsedRef.current = new Set();
      const extraContext = getSessionContext();

      const wrapStreamEvent = (event: ChatSseEvent) => {
        if (event.type === "meta" && event.phase === "tools") {
          for (const t of event.tools) toolsUsedRef.current.add(t);
        }
        options?.onStreamEvent?.(event);
      };

      const payload = messages.map((m) => ({ role: m.role, content: m.content }));
      return postAiChat(
        {
          messages: payload,
          project_id: project.id,
          conversation_id: conversationId,
          project: {
            id: project.id,
            name: project.name,
            instructions: project.instructions,
            memory_notes: project.memoryNotes,
          },
          mode: options?.mode ?? "default",
          athlete_id: options?.athleteId ?? athleteId,
          ui_context: options?.uiContext ?? "target_list",
          flow_mode: options?.flowMode,
          chat_model: options?.chatModel,
          ...(extraContext.trim() ? { extra_system_context: extraContext } : {}),
        },
        {
          signal: options?.signal,
          attachments: options?.attachments,
          onStreamToken: options?.onStreamToken,
          onStreamEvent: wrapStreamEvent,
          interactionResponse: options?.interactionResponse,
        }
      );
    },
    [athleteId, getSessionContext]
  );

  const handleAssistantReply = useCallback(() => {
    const used = toolsUsedRef.current;
    const mutating = [...used].some((t) => TARGET_LIST_MUTATING_TOOLS.has(t));
    if (mutating) onMutatingToolsUsed?.();
    onChatComplete?.();
  }, [onMutatingToolsUsed, onChatComplete]);

  const quickChips = useMemo(
    () =>
      buildQuickChips({
        athleteId,
        athleteName,
        rows,
        activeCategoryFilter,
        selectedCompanyIds,
        focusedRow,
        getSessionContext,
      }),
    [athleteId, athleteName, rows, activeCategoryFilter, selectedCompanyIds, focusedRow, getSessionContext]
  );

  if (collapsed) return null;

  const panelTitle = athleteName
    ? `Mystery Machine — ${athleteName} (TL)`
    : "Mystery Machine (TL)";

  const panelBody = (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[#4F9E63]" aria-hidden />
          <span className="truncate text-sm font-semibold text-[#F4F1EB]">{panelTitle}</span>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-[#D7D0C4] hover:bg-white/5"
          onClick={() => setCollapsed(true)}
          aria-label="Close AI assistant"
        >
          {isMobile ? (
            <>
              Close <X className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Collapse <ChevronRight className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>

      {quickChips.length > 0 ? (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-white/5 px-3 py-2">
          {quickChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="rounded-full border border-[#2E7040]/40 bg-[#1B2F21] px-2.5 py-0.5 text-[11px] font-medium text-[#DBEEE0] hover:bg-[#23452E] disabled:opacity-50"
              onClick={() => void chatRef.current?.submitUserMessage(chip.prompt)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          ref={chatRef}
          title="Mystery Machine"
          roleScope={role}
          onSend={onSend}
          layout="embedded"
          hideHeader
          athleteId={athleteId}
          uiContext="target_list"
          contextAthleteName={athleteName}
          embeddedDedicatedProjectName={`Target list ${athleteId}`}
          placeholder="Add companies, change categories, draft emails…"
          onAssistantReply={handleAssistantReply}
        />
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60"
          aria-label="Close AI assistant"
          onClick={() => setCollapsed(true)}
        />
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-white/10 bg-[#121713] shadow-2xl">
          {panelBody}
        </div>
      </>
    );
  }

  return (
    <div
      className="group/panel relative flex h-full min-h-0 shrink-0 flex-col border-l border-white/10 bg-[#121713]"
      style={{ width: panelWidthPx }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI assistant width"
        tabIndex={0}
        className={cn(
          "absolute left-0 top-0 bottom-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none select-none",
          "hover:bg-[#2E7040]/25 active:bg-[#2E7040]/35",
          "flex items-stretch justify-center outline-none focus-visible:ring-2 focus-visible:ring-[#2E7040]/50 focus-visible:ring-inset",
          panelResizeActive && "bg-[#2E7040]/20"
        )}
        onPointerDown={onPanelResizePointerDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 16;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            const next = clampTargetListPanelWidth(panelWidthPx + step);
            setPanelWidthPx(next);
            try {
              localStorage.setItem(TARGET_LIST_AI_PANEL_WIDTH_KEY, String(next));
            } catch {
              /* ignore */
            }
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            const next = clampTargetListPanelWidth(panelWidthPx - step);
            setPanelWidthPx(next);
            try {
              localStorage.setItem(TARGET_LIST_AI_PANEL_WIDTH_KEY, String(next));
            } catch {
              /* ignore */
            }
          }
        }}
      >
        <span
          className={cn(
            "my-8 w-px min-h-[120px] self-center rounded-full bg-white/20 transition-opacity",
            panelResizeActive ? "opacity-100" : "opacity-40 group-hover/panel:opacity-80"
          )}
          aria-hidden
        />
      </div>
      {panelBody}
    </div>
  );
}

export function TargetListAiPanel(props: TargetListAiPanelProps) {
  return <TargetListAiPanelInner {...props} />;
}

/** @deprecated Use TargetListAiPanel — kept for existing imports */
export function TargetListAiDock(props: TargetListAiDockProps) {
  return <TargetListAiPanelInner {...props} />;
}

export { TARGET_LIST_MUTATING_TOOLS };
