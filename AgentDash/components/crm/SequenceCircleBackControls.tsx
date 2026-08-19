"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  CIRCLE_BACK_MONTH_PRESETS,
  DEFAULT_CIRCLE_BACK_MONTHS,
  formatCircleBackWhen,
  isCircleBackDue,
} from "@/lib/crm/circle-back";

function monthsFromNowDateInput(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string {
  return `${value}T10:00:00.000Z`;
}

export function SequenceReplyPanel({
  stepLabel,
  busy,
  onInterested,
  onCircleBack,
  onRecordOnly,
  onClose,
}: {
  stepLabel: string;
  busy?: boolean;
  onInterested: () => void;
  onCircleBack: (opts: { months?: number; follow_up_at?: string; note?: string }) => void;
  onRecordOnly: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [customDate, setCustomDate] = useState(monthsFromNowDateInput(DEFAULT_CIRCLE_BACK_MONTHS));

  return (
    <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-white/15 bg-[#121614] p-3 shadow-xl space-y-2">
      <div className="text-xs font-medium text-[#F4F1EB]">Reply on {stepLabel}</div>
      <p className="text-[11px] text-[#8E877A]">
        Interested now, or pause the sequence and remind you to follow up later.
      </p>
      <Button
        size="sm"
        className="h-7 w-full text-[11px]"
        disabled={busy}
        onClick={onInterested}
      >
        Interested now — Negotiating
      </Button>
      <div className="space-y-1.5 rounded border border-white/10 bg-[#0F1311] p-2">
        <div className="text-[11px] font-medium text-[#F4E8C0]">Circle back later</div>
        <div className="flex flex-wrap gap-1">
          {CIRCLE_BACK_MONTH_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-[#D7D0C4] hover:bg-white/5"
              onClick={() => onCircleBack({ months: m, note: note.trim() || undefined })}
            >
              {m === DEFAULT_CIRCLE_BACK_MONTHS ? `${m} months` : `${m} mo`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="date"
            className="flex-1 rounded border border-white/15 bg-[#151A17] px-1.5 py-1 text-[11px] text-[#F4F1EB]"
            value={customDate}
            min={monthsFromNowDateInput(0)}
            onChange={(e) => setCustomDate(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[10px]"
            disabled={busy || !customDate}
            onClick={() =>
              onCircleBack({
                follow_up_at: dateInputToIso(customDate),
                note: note.trim() || undefined,
              })
            }
          >
            Set date
          </Button>
        </div>
        <input
          className="w-full rounded border border-white/15 bg-[#151A17] px-1.5 py-1 text-[11px] text-[#F4F1EB]"
          placeholder="Note (budget cycle, Q4…)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <button
        type="button"
        disabled={busy}
        className="w-full text-left text-[11px] text-[#B9B2A6] underline"
        onClick={onRecordOnly}
      >
        Record reply, stay here
      </button>
      <button type="button" className="text-[10px] text-[#8E877A] underline" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

export function SequenceCircleBackBanner({
  circleBackAt,
  circleBackNote,
  busy,
  compact,
  onDone,
  onSnooze,
  onInterested,
}: {
  circleBackAt: string;
  circleBackNote?: string | null;
  busy?: boolean;
  compact?: boolean;
  onDone: () => void;
  onSnooze: (months: number) => void;
  onInterested: () => void;
}) {
  const due = useMemo(() => isCircleBackDue(circleBackAt), [circleBackAt]);
  const when = useMemo(() => formatCircleBackWhen(circleBackAt), [circleBackAt]);

  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 space-y-1",
        due ? "border-amber-400/60 bg-[#3A3420]" : "border-white/10 bg-[#151A17]",
        compact && "px-1.5 py-1"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className={cn("text-[11px] font-medium", due ? "text-[#F4E8C0]" : "text-[#CEE4D4]")}>
            {due ? "Circle back due" : "Circle back scheduled"} · {when}
          </div>
          {circleBackNote ? (
            <div className="text-[10px] text-[#8E877A]">{circleBackNote}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-[10px]"
              disabled={busy}
              onClick={onDone}
            >
              Done
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              disabled={busy}
              onClick={() => onSnooze(DEFAULT_CIRCLE_BACK_MONTHS)}
            >
              Snooze 2 mo
            </Button>
            <Button
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={busy}
              onClick={onInterested}
            >
              Interested
            </Button>
          </div>
      </div>
    </div>
  );
}
