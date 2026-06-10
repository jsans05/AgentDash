"use client";

import { cn } from "@/lib/utils";
import {
  CHAT_MODEL_LABELS,
  type ChatModelTier,
  storeChatModelTier,
} from "@/lib/ai/chat-model";

type Props = {
  value: ChatModelTier;
  onChange: (tier: ChatModelTier) => void;
  disabled?: boolean;
};

const OPTIONS: ChatModelTier[] = ["sonnet", "opus"];

export function ChatModelSelector({ value, onChange, disabled = false }: Props) {
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5"
      role="radiogroup"
      aria-label="Claude model"
    >
      {OPTIONS.map((tier) => {
        const selected = value === tier;
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => {
              if (tier === value) return;
              storeChatModelTier(tier);
              onChange(tier);
            }}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-40",
              selected
                ? "bg-[#2E7040] text-white shadow-sm"
                : "text-[#AFA89C] hover:bg-white/5 hover:text-[#F4F1EB]"
            )}
            title={tier === "opus" ? "Most capable — slower and higher cost" : "Fast default for most tasks"}
          >
            {CHAT_MODEL_LABELS[tier]}
          </button>
        );
      })}
    </div>
  );
}
