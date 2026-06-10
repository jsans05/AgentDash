"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  Globe,
  Plus,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FlowMode } from "@/lib/ai/flow-mode";

export type SelectableFlowMode = Exclude<FlowMode, "auto">;
export type ChatSendMode = "default" | "deep_research" | "web_search";

type ModeOption = {
  id: SelectableFlowMode;
  label: string;
  chipLabel: string;
  subtitle: string;
  icon: typeof Shield;
  chipClass: string;
  menuIconClass: string;
};

type SendModeOption = {
  id: Exclude<ChatSendMode, "default">;
  label: string;
  chipLabel: string;
  subtitle: string;
  icon: typeof Brain;
  chipClass: string;
  menuIconClass: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    id: "outbound",
    label: "Outbound",
    chipLabel: "outbound",
    subtitle: "Find companies to sponsor an athlete",
    icon: Shield,
    chipClass:
      "bg-[#3A2E50] text-[#E6D8FF] border border-[#6A4FA1]/50 font-serif lowercase",
    menuIconClass: "text-[#E6D8FF]",
  },
  {
    id: "inbound",
    label: "Inbound",
    chipLabel: "Inbound",
    subtitle: "Find athletes to pitch to a company",
    icon: SlidersHorizontal,
    chipClass: "bg-[#2A2218] text-[#C9B896] border border-[#5C4A32]/40",
    menuIconClass: "text-[#C9B896]",
  },
  {
    id: "email",
    label: "Email",
    chipLabel: "EMAIL",
    subtitle: "Draft outreach emails",
    icon: Users,
    chipClass:
      "bg-[#1A2332] text-[#C5D0E0] border border-[#4A5F7A]/60 font-serif uppercase tracking-wide text-[11px]",
    menuIconClass: "text-[#C5D0E0]",
  },
];

const SEND_MODE_OPTIONS: SendModeOption[] = [
  {
    id: "deep_research",
    label: "Deep thinking",
    chipLabel: "deep thinking",
    subtitle: "Thorough research with more reasoning",
    icon: Brain,
    chipClass: "bg-[#1C3323] text-[#DBEEE0] border border-[#2E7040]/60",
    menuIconClass: "text-[#9FD4AE]",
  },
  {
    id: "web_search",
    label: "Web search",
    chipLabel: "web search",
    subtitle: "Search the web for up-to-date information",
    icon: Globe,
    chipClass: "bg-[#1C3323] text-[#DBEEE0] border border-[#2E7040]/60",
    menuIconClass: "text-[#9FD4AE]",
  },
];

function modeOption(id: SelectableFlowMode): ModeOption {
  return MODE_OPTIONS.find((m) => m.id === id) ?? MODE_OPTIONS[0]!;
}

function sendModeOption(id: Exclude<ChatSendMode, "default">): SendModeOption {
  return SEND_MODE_OPTIONS.find((m) => m.id === id) ?? SEND_MODE_OPTIONS[0]!;
}

export const COMPOSER_ICON_BUTTON_CLASS =
  "h-7 w-7 shrink-0 rounded-full bg-white/[0.06] p-0 text-[#AFA89C] hover:bg-white/10 hover:text-[#F4F1EB]";

export const COMPOSER_ICON_CLASS = "h-3.5 w-3.5";

type Props = {
  flowMode: FlowMode;
  onFlowModeChange: (mode: FlowMode) => void;
  sendMode?: ChatSendMode;
  onSendModeChange?: (mode: ChatSendMode) => void;
  disabled?: boolean;
  /** CRM embedded: read-only email chip, no + menu */
  readOnlyEmail?: boolean;
};

function ModeChip({
  opt,
  onClear,
  disabled,
  clearLabel,
}: {
  opt: ModeOption | SendModeOption;
  onClear: () => void;
  disabled?: boolean;
  clearLabel: string;
}) {
  const Icon = opt.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-[132px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        opt.chipClass
      )}
      title={opt.subtitle}
    >
      <Icon className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
      <span className="truncate">{opt.chipLabel}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        className="ml-0.5 rounded-full p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100 disabled:opacity-40"
        aria-label={clearLabel}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

export function ChatFlowModeSelector({
  flowMode,
  onFlowModeChange,
  sendMode = "default",
  onSendModeChange,
  disabled = false,
  readOnlyEmail = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setMenuOpen(true);
  }, [disabled]);

  const toggleMenu = useCallback(() => {
    if (disabled) return;
    setMenuOpen((o) => !o);
  }, [disabled]);

  if (readOnlyEmail) {
    const opt = modeOption("email");
    const Icon = opt.icon;
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
          opt.chipClass
        )}
        title={opt.subtitle}
      >
        <Icon className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
        <span>{opt.chipLabel}</span>
      </span>
    );
  }

  const activeFlow = flowMode !== "auto" ? modeOption(flowMode as SelectableFlowMode) : null;
  const activeSend = sendMode !== "default" ? sendModeOption(sendMode) : null;

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={toggleMenu}
        className={COMPOSER_ICON_BUTTON_CLASS}
        aria-label="Select mode"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Plus className={COMPOSER_ICON_CLASS} />
      </Button>

      {activeFlow ? (
        <ModeChip
          opt={activeFlow}
          disabled={disabled}
          clearLabel={`Clear ${activeFlow.label} mode`}
          onClear={() => onFlowModeChange("auto")}
        />
      ) : null}

      {activeSend && onSendModeChange ? (
        <ModeChip
          opt={activeSend}
          disabled={disabled}
          clearLabel={`Clear ${activeSend.label}`}
          onClear={() => onSendModeChange("default")}
        />
      ) : null}

      {!activeFlow ? (
        <button
          type="button"
          disabled={disabled}
          onClick={openMenu}
          className="inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs text-[#AFA89C] transition-colors hover:bg-white/5 hover:text-[#F4F1EB] disabled:opacity-40"
          aria-label="Flow mode: Auto"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span>Auto</span>
          <ChevronDown className="h-3 w-3 opacity-80" aria-hidden />
        </button>
      ) : null}

      {menuOpen ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 min-w-[240px] overflow-hidden rounded-lg border border-white/10 bg-[#1A1F1C] py-1 shadow-lg"
        >
          {MODE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = flowMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onFlowModeChange(opt.id);
                  closeMenu();
                }}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5",
                  selected && "bg-white/[0.06]"
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", opt.menuIconClass)} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[#F4F1EB]">{opt.label}</span>
                  <span className="block text-xs text-[#8E877A]">{opt.subtitle}</span>
                </span>
              </button>
            );
          })}
          {onSendModeChange ? (
            <>
              <div className="my-1 border-t border-white/10" role="separator" />
              {SEND_MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = sendMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onSendModeChange(selected ? "default" : opt.id);
                      closeMenu();
                    }}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5",
                      selected && "bg-white/[0.06]"
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", opt.menuIconClass)} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[#F4F1EB]">{opt.label}</span>
                      <span className="block text-xs text-[#8E877A]">{opt.subtitle}</span>
                    </span>
                  </button>
                );
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
