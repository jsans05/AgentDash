"use client";

import React, { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatEmailDraftCardProps = {
  subject: string;
  body: string;
  disabled?: boolean;
  className?: string;
  onChange: (subject: string, body: string) => void;
};

export function ChatEmailDraftCard({
  subject,
  body,
  disabled = false,
  className,
  onChange,
}: ChatEmailDraftCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [subject, body]);

  return (
    <div
      className={cn(
        "mt-3 w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#1A1F1C] shadow-sm",
        className
      )}
    >
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="shrink-0 pt-2 text-sm text-[#9E978B]">Subject:</span>
          <Textarea
            value={subject}
            onChange={(e) => onChange(e.target.value, body)}
            disabled={disabled}
            rows={1}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-2 text-sm font-medium text-[#F4F1EB] shadow-none focus-visible:ring-0"
            aria-label="Email subject"
          />
        </div>
      </div>

      <Textarea
        value={body}
        onChange={(e) => onChange(subject, e.target.value)}
        disabled={disabled}
        rows={12}
        className="min-h-[12rem] resize-y rounded-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-[#EFEAE1] shadow-none focus-visible:ring-0"
        aria-label="Email body"
      />

      <div className="flex items-center justify-end border-t border-white/10 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void handleCopy()}
          className="h-8 gap-1.5 text-[#AEA79A] hover:bg-white/5 hover:text-[#F4F1EB]"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
