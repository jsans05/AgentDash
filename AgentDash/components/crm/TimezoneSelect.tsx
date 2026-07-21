"use client";

import { COMMON_TIMEZONES, guessTimezoneFromWebsite } from "@/lib/crm/outreach-local-time";
import { cn } from "@/lib/utils";

type Props = {
  value: string | null | undefined;
  onChange: (tz: string | null) => void;
  websiteHint?: string | null;
  className?: string;
  id?: string;
};

export function TimezoneSelect({ value, onChange, websiteHint, className, id }: Props) {
  const guessed = guessTimezoneFromWebsite(websiteHint);
  const options = [...COMMON_TIMEZONES];
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: value });
  }

  return (
    <div className={cn("space-y-1", className)}>
      <select
        id={id}
        className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No timezone set</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {!value && guessed && (
        <button
          type="button"
          className="text-xs text-[#CEE4D4] underline hover:text-[#E8F6ED]"
          onClick={() => onChange(guessed)}
        >
          Use guessed {guessed}
        </button>
      )}
    </div>
  );
}
