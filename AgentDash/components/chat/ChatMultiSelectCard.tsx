"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  USER_QUESTION_OTHER_ID,
  type UserQuestionPrompt,
} from "@/lib/ai/user-question";

const FOREST_GREEN = "#2E7040";

export type ChatMultiSelectCardProps = {
  prompt: UserQuestionPrompt;
  disabled?: boolean;
  onSubmit: (selectedIds: string[], otherText?: string) => void;
  onSkip: () => void;
  onDismiss: () => void;
};

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function ChatMultiSelectCard({
  prompt,
  disabled = false,
  onSubmit,
  onSkip,
  onDismiss,
}: ChatMultiSelectCardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const minSelections = prompt.min_selections ?? (prompt.allow_multiple ? 0 : 1);
  const maxSelections = prompt.max_selections ?? prompt.options.length;

  const selectionCount = useMemo(() => {
    let n = selected.size;
    if (selected.has(USER_QUESTION_OTHER_ID) && !otherText.trim()) {
      // still counts as selected row
    }
    return n;
  }, [selected, otherText]);

  const canSubmit = useMemo(() => {
    if (selectionCount < minSelections) return false;
    if (selectionCount > maxSelections) return false;
    if (selected.has(USER_QUESTION_OTHER_ID) && !otherText.trim()) return false;
    return selectionCount > 0 || minSelections === 0;
  }, [selectionCount, minSelections, maxSelections, selected, otherText]);

  const toggle = (id: string) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (prompt.allow_multiple) {
        if (next.has(id)) next.delete(id);
        else {
          if (next.size >= maxSelections) return prev;
          next.add(id);
        }
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit || disabled) return;
    onSubmit([...selected], selected.has(USER_QUESTION_OTHER_ID) ? otherText.trim() : undefined);
  };

  return (
    <div className="mt-3 w-full max-w-xl rounded-2xl border border-white/10 bg-[#1A1F1C] shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <p className="font-serif text-base leading-snug text-[#F4F1EB]">{prompt.question}</p>
        <button
          type="button"
          onClick={onDismiss}
          disabled={disabled}
          className="shrink-0 rounded-md p-1 text-[#9E978B] hover:bg-white/5 hover:text-[#F4F1EB] disabled:opacity-50"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="max-h-[min(24rem,55vh)] divide-y divide-white/10 overflow-y-auto overscroll-contain">
        {prompt.options.map((opt, index) => {
          const isSelected = selected.has(opt.id);
          const isOther = opt.id === USER_QUESTION_OTHER_ID;
          const isHovered = hoveredId === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                role={prompt.allow_multiple ? "checkbox" : "radio"}
                aria-checked={isSelected}
                disabled={disabled}
                onMouseEnter={() => setHoveredId(opt.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => toggle(opt.id)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                  (isHovered || isSelected) && "bg-white/5",
                  isOther && "text-[#AEA79A]"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    isSelected
                      ? "border-[#2E7040] bg-[#2E7040] text-[#EDF7F0]"
                      : "border-white/25 bg-transparent"
                  )}
                >
                  {isSelected ? (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="currentColor" aria-hidden>
                      <path d="M10.2 2.4 4.8 8.4 1.8 5.4l1.2-1.2 1.8 1.8 4.2-4.8 1.2 1.2z" />
                    </svg>
                  ) : null}
                </span>
                <span className="text-sm text-[#EFEAE1]">
                  {optionLetter(index)}) {opt.label}
                </span>
              </button>
              {isOther && isSelected ? (
                <div className="px-4 pb-3 pl-11">
                  <Textarea
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    placeholder="Tell us more..."
                    disabled={disabled}
                    rows={2}
                    className="min-h-0 resize-none border-white/15 bg-[#121613] text-sm text-[#F4F1EB]"
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
        <span className="text-xs text-[#9E978B]">
          {selectionCount} selected
        </span>
        <div className="flex items-center gap-2">
          {prompt.allow_skip ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onSkip}
              className="border-white/20 bg-transparent text-[#E6E0D5] hover:bg-white/5"
            >
              Skip
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            disabled={disabled || !canSubmit}
            onClick={handleSubmit}
            className="h-9 w-9 rounded-lg text-white hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: FOREST_GREEN }}
            aria-label="Submit selection"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
