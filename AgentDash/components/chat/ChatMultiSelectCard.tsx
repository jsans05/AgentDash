"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  USER_QUESTION_OTHER_ID,
  type UserQuestionOption,
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

function OptionRow({
  opt,
  index,
  prompt,
  disabled,
  isSelected,
  isHovered,
  otherText,
  setOtherText,
  onHover,
  onLeave,
  onToggle,
}: {
  opt: UserQuestionOption;
  index: number;
  prompt: UserQuestionPrompt;
  disabled: boolean;
  isSelected: boolean;
  isHovered: boolean;
  otherText: string;
  setOtherText: (value: string) => void;
  onHover: () => void;
  onLeave: () => void;
  onToggle: () => void;
}) {
  const isOther = opt.id === USER_QUESTION_OTHER_ID;
  return (
    <li>
      <button
        type="button"
        role={prompt.allow_multiple ? "checkbox" : "radio"}
        aria-checked={isSelected}
        disabled={disabled}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onClick={onToggle}
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
  const categorized = prompt.options.some((option) => Boolean(option.category));

  const groupedOptions = useMemo(() => {
    if (!categorized) return null;
    const groups = new Map<string, UserQuestionOption[]>();
    for (const option of prompt.options) {
      const category = option.category ?? "Other";
      const rows = groups.get(category) ?? [];
      rows.push(option);
      groups.set(category, rows);
    }
    return [...groups.entries()];
  }, [categorized, prompt.options]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => {
    if (!groupedOptions) return new Set();
    return new Set(groupedOptions.slice(0, 2).map(([category]) => category));
  });

  const selectionCount = selected.size;

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

  let flatIndex = 0;

  return (
    <div className="mt-3 w-full max-w-xl rounded-2xl border border-white/10 bg-[#1A1F1C] shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="font-serif text-base leading-snug text-[#F4F1EB]">{prompt.question}</p>
          <p className="mt-1 text-xs text-[#9E978B]">{selectionCount} selected</p>
        </div>
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

      <div className="max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain">
        {categorized && groupedOptions ? (
          <div className="divide-y divide-white/10">
            {groupedOptions.map(([category, options]) => {
              const expanded = expandedCategories.has(category);
              return (
                <section key={category}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-[#D8D2C7] hover:bg-white/5"
                    onClick={() =>
                      setExpandedCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(category)) next.delete(category);
                        else next.add(category);
                        return next;
                      })
                    }
                  >
                    <span>{category}</span>
                    <span className="flex items-center gap-2 text-xs text-[#9E978B]">
                      {options.length}
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>
                  {expanded ? (
                    <ul className="divide-y divide-white/10 border-t border-white/10">
                      {options.map((opt) => {
                        const index = flatIndex++;
                        return (
                          <OptionRow
                            key={opt.id}
                            opt={opt}
                            index={index}
                            prompt={prompt}
                            disabled={disabled}
                            isSelected={selected.has(opt.id)}
                            isHovered={hoveredId === opt.id}
                            otherText={otherText}
                            setOtherText={setOtherText}
                            onHover={() => setHoveredId(opt.id)}
                            onLeave={() => setHoveredId(null)}
                            onToggle={() => toggle(opt.id)}
                          />
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {prompt.options.map((opt, index) => (
              <OptionRow
                key={opt.id}
                opt={opt}
                index={index}
                prompt={prompt}
                disabled={disabled}
                isSelected={selected.has(opt.id)}
                isHovered={hoveredId === opt.id}
                otherText={otherText}
                setOtherText={setOtherText}
                onHover={() => setHoveredId(opt.id)}
                onLeave={() => setHoveredId(null)}
                onToggle={() => toggle(opt.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
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
  );
}
