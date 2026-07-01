"use client";

import { useEffect, useRef, useState } from "react";

export type EditableCellProps = {
  value: string | null | undefined;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  display?: (v: string) => React.ReactNode;
  className?: string;
  minHeightPx?: number;
};

export function EditableCell({
  value,
  onSave,
  placeholder,
  multiline,
  disabled,
  display,
  className,
  minHeightPx = 28,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setLocal(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  async function commit() {
    const next = local.trim();
    const prev = (value ?? "").trim();
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const rendered = display
      ? display(value ?? "")
      : value
        ? <span className="text-[#ECE7DF]">{value}</span>
        : <span className="text-[#8E877A]">—</span>;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : "Click to edit"}
        className={`w-full rounded px-0.5 py-0.5 text-left hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-1 focus:ring-[#2E7040]/60 ${
          disabled ? "cursor-default hover:bg-transparent" : "cursor-text"
        } ${className ?? ""}`}
        style={{ minHeight: minHeightPx }}
      >
        {rendered}
      </button>
    );
  }

  const commonClass =
    "w-full rounded border border-[#2E7040]/50 bg-[#101513] px-1 py-0.5 text-sm text-[#ECE7DF] placeholder:text-[#8E877A] focus:outline-none focus:ring-1 focus:ring-[#2E7040]";

  return (
    <div className="space-y-1">
      {multiline ? (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          className={`${commonClass} resize-y`}
          rows={3}
          value={local}
          placeholder={placeholder}
          disabled={saving}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLocal(value ?? "");
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void commit();
            }
          }}
        />
      ) : (
        <input
          ref={(el) => {
            inputRef.current = el;
          }}
          className={commonClass}
          value={local}
          placeholder={placeholder}
          disabled={saving}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLocal(value ?? "");
              setEditing(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
          }}
        />
      )}
      {error ? <span className="text-[11px] text-[#F1A2A2]">{error}</span> : null}
    </div>
  );
}
