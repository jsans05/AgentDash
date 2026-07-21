"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { channelLabel, type OutreachChannel } from "@/lib/crm/outreach-sequence";
import { VARIANT_LABELS, type OutreachVariant } from "@/lib/crm/outreach-variants";

const CHANNELS: OutreachChannel[] = [
  "cold_email",
  "support_email",
  "linkedin",
  "cold_call",
  "instagram_dm",
  "instagram_engage",
];

export function VariantsLibrary() {
  const [variants, setVariants] = useState<OutreachVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<OutreachChannel>("cold_email");
  const [label, setLabel] = useState<string>("A");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/variants", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setVariants((json.variants ?? []) as OutreachVariant[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byChannel = useMemo(() => {
    const map = new Map<string, OutreachVariant[]>();
    for (const ch of CHANNELS) map.set(ch, []);
    for (const v of variants) {
      const list = map.get(v.channel) ?? [];
      list.push(v);
      map.set(v.channel, list);
    }
    return map;
  }, [variants]);

  const create = async () => {
    if (!body.trim()) {
      setError("Paste your message body first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/variants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          variant_label: label,
          name: name.trim() || null,
          subject: subject.trim() || null,
          body: body.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setBody("");
      setSubject("");
      setName("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (v: OutreachVariant) => {
    const res = await fetch(`/api/crm/variants/${v.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !v.is_active }),
    });
    if (res.ok) await load();
  };

  const archive = async (v: OutreachVariant) => {
    if (!window.confirm(`Archive variant ${v.variant_label}? Historical stats are kept.`)) return;
    const res = await fetch(`/api/crm/variants/${v.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) await load();
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#F4F1EB]">My Variants</h1>
          <p className="mt-1 text-sm text-[#B9B2A6]">
            Paste the exact copy you send for A/B/C tests. Separate from AI email templates — just
            copy → paste into Gmail/LinkedIn/IG → mark the sequence cell green.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/crm/sequence"
            className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-sm text-[#D7D0C4] hover:bg-white/5"
          >
            Sequence board
          </Link>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-[#F1A2A2]">{error}</p>}

      <div className="rounded-lg border border-white/10 bg-[#151A17] p-4 space-y-3">
        <h2 className="text-sm font-medium text-[#F4F1EB]">Add variant</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-xs text-[#B9B2A6]">
            Channel
            <select
              className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
              value={channel}
              onChange={(e) => setChannel(e.target.value as OutreachChannel)}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[#B9B2A6]">
            Label
            <select
              className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            >
              {VARIANT_LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[#B9B2A6] sm:col-span-2">
            Name (optional)
            <input
              className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. problem question hook"
            />
          </label>
        </div>
        {(channel === "cold_email" || channel === "support_email") && (
          <label className="block space-y-1 text-xs text-[#B9B2A6]">
            Subject (optional)
            <input
              className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
        )}
        <label className="block space-y-1 text-xs text-[#B9B2A6]">
          Body — paste your message
          <textarea
            className="w-full rounded-md border border-white/15 bg-[#0F1311] px-2 py-1.5 text-sm text-[#F4F1EB]"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste the exact copy you'll send…"
          />
        </label>
        <Button size="sm" disabled={saving} onClick={() => void create()}>
          {saving ? "Saving…" : "Save variant"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[#B9B2A6]">Loading…</p>
      ) : (
        <div className="space-y-6">
          {CHANNELS.map((ch) => {
            const list = byChannel.get(ch) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={ch} className="space-y-2">
                <h3 className="text-sm font-semibold text-[#F4F1EB]">{channelLabel(ch)}</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((v) => (
                    <div
                      key={v.id}
                      className="rounded-lg border border-white/10 bg-[#151A17] p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold text-[#CEE4D4]">
                            Variant {v.variant_label}
                          </span>
                          {v.name && (
                            <span className="ml-2 text-xs text-[#B9B2A6]">{v.name}</span>
                          )}
                          <div className="text-[10px] text-[#8E877A]">
                            {v.send_count ?? 0} sends
                            {!v.is_active ? " · inactive" : ""}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px]"
                            onClick={() => void toggleActive(v)}
                          >
                            {v.is_active ? "Pause" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px]"
                            onClick={() => void archive(v)}
                          >
                            Archive
                          </Button>
                        </div>
                      </div>
                      {v.subject && (
                        <p className="text-xs text-[#B9B2A6]">
                          <span className="text-[#8E877A]">Subject:</span> {v.subject}
                        </p>
                      )}
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-white/5 bg-[#0F1311] p-2 text-[11px] text-[#D7D0C4]">
                        {v.body}
                      </pre>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            [v.subject, v.body].filter(Boolean).join("\n\n")
                          )
                        }
                      >
                        Copy
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {variants.length === 0 && (
            <p className="text-sm text-[#8E877A]">
              No variants yet. Paste your first A/B/C copy above to start testing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
