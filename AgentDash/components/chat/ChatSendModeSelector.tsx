"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Globe, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  COMPOSER_ICON_BUTTON_CLASS,
  COMPOSER_ICON_CLASS,
} from "./ChatFlowModeSelector";

export type ChatSendMode = "default" | "deep_research" | "web_search";

type SendModeOption = {
  id: Exclude<ChatSendMode, "default">;
  label: string;
  chipLabel: string;
  subtitle: string;
  icon: typeof Brain;
};

const SEND_MODE_OPTIONS: SendModeOption[] = [
  {
    id: "deep_research",
    label: "Deep thinking",
    chipLabel: "deep thinking",
    subtitle: "Thorough research with more reasoning",
    icon: Brain,
  },
  {
    id: "web_search",
    label: "Web search",
    chipLabel: "web search",
    subtitle: "Search the web for up-to-date information",
    icon: Globe,
  },
];

type Props = {
  value: ChatSendMode;
  onChange: (mode: ChatSendMode) => void;
  disabled?: boolean;
};

export function ChatSendModeSelector({ value, onChange, disabled = false }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const activeOption =
    value === "default"
      ? null
      : SEND_MODE_OPTIONS.find((opt) => opt.id === value) ?? null;

  const toggleMenu = () => {
    if (disabled) return;
    setMenuOpen((open) => !open);
  };

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0 items-center gap-1">
      {activeOption ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-[#2E7040]/50 bg-[#2E7040]/15 px-2 py-0.5 text-[10px] font-medium text-[#C8E6CF]"
          title={activeOption.subtitle}
        >
          <activeOption.icon className="h-3 w-3 shrink-0 opacity-90" aria-hidden />
          <span>{activeOption.chipLabel}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange("default")}
            className="rounded-full p-0.5 text-[#C8E6CF]/80 hover:bg-white/10 hover:text-[#F4F1EB] disabled:opacity-40"
            aria-label={`Clear ${activeOption.label}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggleMenu}
        disabled={disabled}
        className={COMPOSER_ICON_BUTTON_CLASS}
        aria-label="Select send mode"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Plus className={COMPOSER_ICON_CLASS} />
      </Button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-xl border border-white/10 bg-[#151917] p-1 shadow-xl"
        >
          {SEND_MODE_OPTIONS.map((opt) => {
            const selected = value === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(selected ? "default" : opt.id);
                  setMenuOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  selected ? "bg-[#2E7040]/20 text-[#F4F1EB]" : "text-[#D1CABF] hover:bg-white/5"
                )}
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
                <span>
                  <span className="block text-[11px] font-medium">{opt.label}</span>
                  <span className="mt-0.5 block text-[10px] text-[#AFA89C]">{opt.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
